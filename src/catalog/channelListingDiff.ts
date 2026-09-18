export type CanonicalListing = {
  sku: string;
  price: number;
  stock: number;
  title: string;
};

export type ChannelListing = CanonicalListing & { market: string };
export type ListingField = "price" | "stock" | "title";

export type ChannelListingDiff = {
  sku: string;
  market: string;
  changedFields: ListingField[];
  requiresApproval: boolean;
};

export function diffChannelListings(
  canonical: CanonicalListing[],
  channelRows: ChannelListing[],
  approvalPriceChangeRate = 0.2,
): ChannelListingDiff[] {
  const bySku = new Map(canonical.map((row) => [row.sku, row]));
  return channelRows.flatMap((row) => {
    const base = bySku.get(row.sku);
    if (!base) return [];
    const changedFields: ListingField[] = [];
    if (base.price !== row.price) changedFields.push("price");
    if (base.stock !== row.stock) changedFields.push("stock");
    if (base.title !== row.title) changedFields.push("title");
    if (!changedFields.length) return [];
    const priceRate = base.price > 0 ? Math.abs(row.price - base.price) / base.price : 0;
    return [{ sku: row.sku, market: row.market, changedFields, requiresApproval: priceRate >= approvalPriceChangeRate }];
  });
}
