export const INSTRUMENT_PROFILE_SCHEMA_VERSION = "instrument-profile-v1";
export const INSTRUMENT_EVIDENCE_POLICY_VERSION = "instrument-evidence-policy-v1";

export type InstrumentType = "a_share_stock" | "etf" | "index" | "unknown";
export type InstrumentClassificationSource = "exchange_symbol" | "unknown";

export type InstrumentProfile = {
  schemaVersion: typeof INSTRUMENT_PROFILE_SCHEMA_VERSION;
  instrumentType: InstrumentType;
  classificationSource: InstrumentClassificationSource;
  evidencePolicyVersion: typeof INSTRUMENT_EVIDENCE_POLICY_VERSION;
};

const SH_ETF_PREFIXES = ["510", "511", "512", "513", "515", "516", "517", "518", "560", "561", "562", "563", "588", "589"];
const SH_STOCK_PREFIXES = ["600", "601", "603", "605", "688", "689"];
const SZ_STOCK_PREFIXES = ["000", "001", "002", "003", "300", "301"];

export function buildInstrumentProfile(symbol: string): InstrumentProfile {
  const normalized = symbol.trim().toUpperCase();
  const [code, suffix = ""] = normalized.split(".");
  const instrumentType = classifyByExchangeSymbol(code, suffix);
  return {
    schemaVersion: INSTRUMENT_PROFILE_SCHEMA_VERSION,
    instrumentType,
    classificationSource: instrumentType === "unknown" ? "unknown" : "exchange_symbol",
    evidencePolicyVersion: INSTRUMENT_EVIDENCE_POLICY_VERSION
  };
}

function classifyByExchangeSymbol(code: string, suffix: string): InstrumentType {
  if (!/^\d{6}$/.test(code)) return "unknown";
  if ((suffix === "SH" && (code.startsWith("000") || code.startsWith("930") || code.startsWith("931"))) ||
      (suffix === "SZ" && code.startsWith("399"))) return "index";
  if ((suffix === "SH" && SH_ETF_PREFIXES.some((prefix) => code.startsWith(prefix))) ||
      (suffix === "SZ" && code.startsWith("159"))) return "etf";
  if ((suffix === "SH" && SH_STOCK_PREFIXES.some((prefix) => code.startsWith(prefix))) ||
      (suffix === "SZ" && SZ_STOCK_PREFIXES.some((prefix) => code.startsWith(prefix))) ||
      (suffix === "BJ" && /^[489]/.test(code))) return "a_share_stock";
  return "unknown";
}
