import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DbService } from './db.service';
import { lockPhone, lockUser, transactionOptions } from './business';
import { EventsService } from './events.service';
import { FulfillmentService } from './fulfillment.service';
import { OutboundService } from './outbound.service';
import { IncomingService } from './incoming.service';

@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger=new Logger(MaintenanceService.name);
  private timer?: NodeJS.Timeout;
  private running=false;
  constructor(private readonly db:DbService,private readonly events:EventsService,private readonly fulfillment:FulfillmentService,private readonly outbound:OutboundService,private readonly incoming:IncomingService) {}
  onModuleInit() {
    this.timer=setInterval(()=>{void this.tick();},30000);
    this.timer.unref();
    void this.tick();
  }
  onModuleDestroy() { if(this.timer) clearInterval(this.timer); }
  async expireBatch(limit=100) {
    const rows=await this.db.lease.findMany({where:{status:'ACTIVE',expiresAt:{lte:new Date()}},orderBy:[{expiresAt:'asc'},{id:'asc'}],take:limit});
    let changed=0;
    for(const row of rows) {
      changed+=await this.db.$transaction(async tx => {
        // All writers use account -> phone -> lease/order. Re-read after locks.
        await lockUser(tx,row.userId);
        await lockPhone(tx,row.phoneNumberId);
        const lease=await tx.lease.findUniqueOrThrow({where:{id:row.id}});
        if(lease.status!=='ACTIVE' || lease.expiresAt>new Date()) return 0;
        const result=await tx.lease.updateMany({where:{id:row.id,status:'ACTIVE',expiresAt:lease.expiresAt},data:{status:'EXPIRED_HELD',endedAt:lease.expiresAt}});
        if(result.count!==1) return 0;
        await tx.phoneNumber.update({where:{id:row.phoneNumberId},data:{occupied:true,holdReason:'EXPIRY_RELEASE_RULES_UNCONFIRMED'}});
        await tx.auditLog.create({data:{userId:row.userId,action:'LEASE_EXPIRED_HELD',resourceId:row.id,
          details:{from:'ACTIVE',to:'EXPIRED_HELD',reason:'EXPIRY_RELEASE_RULES_UNCONFIRMED',endedAt:lease.expiresAt.toISOString()}}});
        return 1;
      },transactionOptions);
    }
    return {scanned:rows.length,changed};
  }
  private async tick() {
    if(this.running) return;
    this.running=true;
    try { await this.expireBatch(); await this.fulfillment.recoverClaims(); await this.events.recover(); await this.outbound.recover(); await this.incoming.recover(); }
    catch { this.logger.error('Local maintenance failed; persisted work remains for the next bounded pass'); }
    finally { this.running=false; }
  }
}
