export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const FREE_COST_LABEL = "$0 within available free quotas";

export type ApiErrorCode =
  | "invalid_input" | "unauthorized" | "forbidden" | "missing_configuration"
  | "quota_exhausted" | "provider_refusal" | "timeout" | "upstream_failure";
export type ApiErrorBody = { error: { code: ApiErrorCode; message: string } };
