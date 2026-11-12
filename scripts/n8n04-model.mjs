// Pinned for each benchmark; preparation verifies the current free endpoint and capabilities.
export const modelId = "nvidia/nemotron-3.5-lightning-20260807:free";
// Endpoint metadata id + observed response agree; generation metadata still pins the dated model.
export const responseModelId = "nvidia/nemotron-3.5-lightning:free";
export const providerName = "Nvidia";
export const providerSlug = "nvidia/nvfp4";
export const temperature = 0;
// Two provider calls leave 10s of Draft headroom; workflow/lease remain 55s/60s.
export const providerTimeoutMs = 10000;
export const modelNodeTimeoutMs = 12000;
export const draftBudgetMs = 30000;
