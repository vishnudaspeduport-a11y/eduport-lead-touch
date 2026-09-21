/** Supabase session pooler (port 5432) allows only 15 clients on the free plan and Hyperdrive keeps most of them;
 *  jobs use the transaction pooler (port 6543), which allows far more. */
export function txPooler(url: string): string {
  return url.includes('pooler.supabase.com:5432/') ? url.replace('pooler.supabase.com:5432/', 'pooler.supabase.com:6543/') : url;
}
