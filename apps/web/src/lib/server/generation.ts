import { authorize } from "./session";
import { endpoint } from "./http";

export function generation(request: Request, work: (signal: AbortSignal) => Promise<Response>) {
  return endpoint(async () => {
    authorize(request);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(85000)]);
    return work(signal);
  });
}
