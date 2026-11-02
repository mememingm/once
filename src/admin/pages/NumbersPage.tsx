import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { listOptions } from "../api";
import { useAdminPage } from "../context";
import { Badge, DateText, Pager, RowMenu, State, Table, daysLeft, rowClick } from "../primitives";

export function NumbersPage() {
  const { input, update, openDetail, openAction } = useAdminPage();
  const result = useQuery(listOptions("numbers", input));
  return <section className="oa-card">
    <State query={result} columns={6} empty={result.data?.items.length === 0} />
    {result.data && result.data.items.length > 0 && <Table label="号码库存" columns={["号码", "地区", "来源", "状态", "当前用户", "租约到期", ""]}>
      {result.data.items.map(number => <tr key={number.id} className="oa-clickable" onClick={rowClick(() => openDetail({ section: "numbers", id: number.id }))}>
        <td><strong className="oa-mono">{number.number}</strong></td><td>{number.countryName}<small>{number.regionName}</small></td>
        <td><Badge value={number.provider} />{number.providerStatus && number.providerStatus !== "ACTIVE" && <small className="oa-error-text">上游 {number.providerStatus}</small>}</td>
        <td><Badge value={number.saleStatus} />{number.holdReason && number.saleStatus === "HELD" && <small>{number.holdReason === "EXPIRY_RELEASE_RULES_UNCONFIRMED" ? "到期保留" : number.holdReason}</small>}</td>
        <td>{number.currentLease?.email ?? <span className="oa-faint">—</span>}</td>
        <td>{number.currentLease ? <><DateText value={number.currentLease.expiresAt} /><small>{daysLeft(number.currentLease.expiresAt)}</small></> : "—"}</td>
        <td><div className="oa-row-actions">
          {number.saleStatus === "AVAILABLE" && <Button size="sm" variant="outline" onClick={() => openAction({ kind: "assign", number })}>分配</Button>}
          <RowMenu items={[
            { label: "查看详情和历史", onSelect: () => openDetail({ section: "numbers", id: number.id }) },
            ...(number.saleStatus === "OCCUPIED" ? [] : [{ label: number.saleStatus === "HELD" ? "恢复售卖" : "暂停售卖", onSelect: () => openAction({ kind: "hold", number }) }]),
          ]} /></div></td>
      </tr>)}
    </Table>}
    <Pager data={result.data} onPage={page => update("page", String(page))} />
  </section>;
}
