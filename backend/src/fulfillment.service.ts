import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Order, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DbService } from './db.service';
import { settings } from './config';
import { day, fingerprint, idempotencyKey, lockPhone, lockUser, plans, transactionOptions } from './business';

export type MockScenario = 'SUCCESS' | 'FAILURE' | 'UNKNOWN_SUCCESS' | 'UNKNOWN_FAILURE';
const terminal = ['DEMO_CONFIRMED','FAILED'];
function view(order: Order) {
  return {orderId:order.id,leaseId:order.leaseId,number:order.numberSnapshot,status:order.status,term:order.termDays,
    amount:order.amountMinor/100,currency:order.currency,demo:true,requestId:order.id,scenario:order.mockScenario,
    attempts:order.attempts,claimUntil:order.claimUntil,lastError:order.lastError,checkedAt:order.checkedAt,
    completedAt:order.completedAt,providerOrderId:order.providerOrderId,evidence:order.evidence};
}
@Injectable()
export class FulfillmentService {
  constructor(private readonly db:DbService) {}
  private demoOnly() {
    if (!settings.demo || settings.production) throw new ForbiddenException('Local fulfillment simulation is disabled');
  }
  async create(userId:string,number:string,term:number,scenario:MockScenario,key:unknown) {
    this.demoOnly();
    const requestKey = idempotencyKey(key);
    const requestHash = fingerprint({kind:'MOCK_RENT',number,term,scenario});
    return this.db.$transaction(async tx => {
      await lockUser(tx,userId);
      const existing = await tx.order.findUnique({where:{userId_idempotencyKey:{userId,idempotencyKey:requestKey}}});
      if (existing) {
        if (existing.requestHash!==requestHash) throw new ConflictException('Idempotency key was already used for a different request');
        return {...view(existing),replayed:true};
      }
      const phone = await tx.phoneNumber.findUnique({where:{number}});
      if (!phone || phone.provider!=='demo') throw new NotFoundException('Demo number not found');
      const claimed = await tx.phoneNumber.updateMany({where:{id:phone.id,occupied:false,holdReason:null,provider:'demo'},data:{occupied:true,holdReason:'MOCK_ORDER_PENDING'}});
      if (claimed.count!==1) throw new ConflictException('Number is no longer available');
      const order = await tx.order.create({data:{userId,phoneNumberId:phone.id,numberSnapshot:phone.number,kind:'RENT',termDays:term,
        amountMinor:plans[term],idempotencyKey:requestKey,requestHash,mockScenario:scenario,status:'PENDING'}});
      await tx.auditLog.create({data:{userId,action:'MOCK_ORDER_CREATED',resourceId:order.id,details:{status:'PENDING',scenario}}});
      return {...view(order),replayed:false};
    },transactionOptions);
  }
  async get(userId:string,id:string) {
    this.demoOnly();
    const order = await this.db.order.findFirst({where:{id,userId,mockScenario:{not:null}}});
    if (!order) throw new NotFoundException('Mock order not found');
    return view(order);
  }
  private async claim(userId:string,id:string,reconcile:boolean) {
    return this.db.$transaction(async tx => {
      await lockUser(tx,userId);
      let order = await tx.order.findFirst({where:{id,userId,mockScenario:{not:null}}});
      if (!order) throw new NotFoundException('Mock order not found');
      if (terminal.includes(order.status)) return {order,token:null};
      if (order.status==='PROCESSING') {
        if (order.claimUntil && order.claimUntil > new Date()) return {order,token:null};
        // A lost worker does not prove failure. Never repeat the simulated purchase.
        order = await tx.order.update({where:{id},data:{status:'UNCERTAIN',claimToken:null,claimUntil:null,lastError:'WORKER_CLAIM_EXPIRED'}});
        await tx.auditLog.create({data:{userId,action:'MOCK_CLAIM_EXPIRED',resourceId:id,details:{from:'PROCESSING',to:'UNCERTAIN'}}});
      }
      if (reconcile ? order.status!=='UNCERTAIN' : order.status!=='PENDING') return {order,token:null};
      const token = randomUUID();
      order = await tx.order.update({where:{id},data:{status:'PROCESSING',claimToken:token,claimUntil:new Date(Date.now()+30000),attempts:{increment:1}}});
      await tx.auditLog.create({data:{userId,action:reconcile?'MOCK_LOOKUP_CLAIMED':'MOCK_PURCHASE_CLAIMED',resourceId:id,
        details:{token,requestId:id,attempt:order.attempts,from:reconcile?'UNCERTAIN':'PENDING',to:'PROCESSING'}}});
      return {order,token};
    },transactionOptions);
  }
  async run(userId:string,id:string,reconcile=false) {
    this.demoOnly();
    const claim = await this.claim(userId,id,reconcile);
    if (!claim.token) return view(claim.order);
    // Provider boundary: no database transaction/lock is held here. This is local simulation only.
    const outcome = !reconcile && claim.order.mockScenario!.startsWith('UNKNOWN_') ? 'UNCERTAIN'
      : claim.order.mockScenario!.endsWith('SUCCESS') ? 'DEMO_CONFIRMED' : 'FAILED';
    const evidence = {provider:'local-mock',requestId:id,phase:reconcile?'LOOKUP':'PURCHASE',outcome,observedAt:new Date().toISOString()};
    return this.db.$transaction(async tx => {
      await lockUser(tx,userId);
      await lockPhone(tx,claim.order.phoneNumberId!);
      const order = await tx.order.findFirstOrThrow({where:{id,userId}});
      if (order.status!=='PROCESSING' || order.claimToken!==claim.token || !order.claimUntil || order.claimUntil<=new Date()) return view(order);
      const phone = await tx.phoneNumber.findUniqueOrThrow({where:{id:order.phoneNumberId!}});
      if (!phone.occupied || phone.holdReason!=='MOCK_ORDER_PENDING') throw new ConflictException('Order reservation requires investigation');
      let leaseId: string | null = null;
      const now = new Date();
      if (outcome==='DEMO_CONFIRMED') {
        // Service time starts only when this local delivery is confirmed; no fake pending lease.
        const lease = await tx.lease.create({data:{userId,phoneNumberId:phone.id,termDays:order.termDays,priceMinor:order.amountMinor,
          currency:order.currency,startedAt:now,expiresAt:new Date(now.getTime()+order.termDays*day)}});
        leaseId=lease.id;
        await tx.phoneNumber.update({where:{id:phone.id},data:{holdReason:null}});
      } else if (outcome==='FAILED') {
        // Only a definite local mock failure releases this mock reservation. No external release/refund.
        await tx.phoneNumber.update({where:{id:phone.id},data:{occupied:false,holdReason:null}});
      }
      const updated = await tx.order.update({where:{id},data:{status:outcome,leaseId,claimToken:null,claimUntil:null,evidence,
        checkedAt:reconcile?now:undefined,completedAt:outcome==='UNCERTAIN'?null:now,
        providerOrderId:outcome==='DEMO_CONFIRMED'?`mock:${id}`:undefined,lastError:outcome==='UNCERTAIN'?'MOCK_RESPONSE_LOST':outcome==='FAILED'?'MOCK_DEFINITE_FAILURE':null}});
      await tx.auditLog.create({data:{userId,action:'MOCK_ORDER_'+outcome,resourceId:id,details:{from:'PROCESSING',to:outcome,evidence,claimToken:claim.token}}});
      return view(updated);
    },transactionOptions);
  }
  async recoverClaims(limit=100) {
    if (!settings.demo || settings.production) return;
    const rows = await this.db.order.findMany({where:{status:'PROCESSING',mockScenario:{not:null},claimUntil:{lte:new Date()}},orderBy:[{claimUntil:'asc'},{id:'asc'}],take:limit});
    // claim(false) only changes expired PROCESSING to UNCERTAIN; it never reissues the purchase.
    for (const row of rows) await this.claim(row.userId,row.id,false);
  }
}
