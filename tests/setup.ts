import { setCatalog, type CatalogRow } from "@/lib/catalog";
import rows from "./fixtures/catalog.json";

setCatalog(rows as CatalogRow[]);
