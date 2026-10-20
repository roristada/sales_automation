import type { z } from "zod";
import type { ProductInput, ProductSource, productInputSchema, StoredStatus } from "@/features/products/schema";

/** How products enter the system from this source. */
export type SourceMode = "manual" | "file" | "api";

/**
 * - available: usable now (manual entry, CSV upload, or an API with working credentials)
 * - not_connected: supported, but credentials are not set up
 * - not_available: no confirmed API access for this account/region yet
 */
export type ConnectionState = "available" | "not_connected" | "not_available";

export interface SourceConnection {
  state: ConnectionState;
  /** Plain-language status for the user. Never contains secrets. */
  note: string;
}

export interface SourceProductQuery {
  keyword?: string;
  category?: string;
  limit: number;
  cursor?: string;
}

/** One product as an API source returns it, in the shared schema's input shape (unvalidated). */
export type RawSourceProduct = z.input<typeof productInputSchema>;

export interface SourceProductPage {
  products: RawSourceProduct[];
  nextCursor: string | null;
  /** When the source produced this data (becomes products.retrieved_at). */
  retrievedAt: string;
}

/**
 * A place products come from. Business logic talks to this interface, never to a vendor SDK.
 * Every adapter maps into the shared product schema, so manual, CSV and API products are
 * validated the same way.
 */
export interface ProductSourceAdapter {
  key: ProductSource;
  label: string;
  mode: SourceMode;
  /** Provenance recorded for fields this source supplies. */
  provenance: StoredStatus;
  connection(): SourceConnection;
  /** API sources only. Absent until the integration is implemented. */
  fetchProducts?(query: SourceProductQuery): Promise<SourceProductPage>;
}

export interface NormalizedPage {
  valid: (ProductInput & { retrieved_at: string })[];
  invalid: { index: number; errors: { field: string; message: string }[] }[];
  nextCursor: string | null;
}

export class SourceNotConnectedError extends Error {
  constructor(
    readonly source: ProductSource,
    readonly connection: SourceConnection,
  ) {
    super(connection.note);
    this.name = "SourceNotConnectedError";
  }
}
