export class ApiError extends Error {
  constructor(public status: number, message: string) {super(message);}
}
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {method: body === undefined ? 'GET' : 'POST', credentials: 'include', headers: {'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal});
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, typeof data.detail === 'string' ? data.detail : data.detail ? data.detail.map((d: {loc: string[]; msg: string}) => `${d.loc.slice(1).join('.')}: ${d.msg}`).join('; ') : 'Request failed');
  }
  return response.json();
}
