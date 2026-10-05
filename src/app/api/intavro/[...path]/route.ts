import { intentProductHandler } from '@/features/intent-product/runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
type Context={params:Promise<{path:string[]}>};
async function handler(request:Request,{params}:Context){return intentProductHandler()(request,(await params).path);}
export const GET=handler;
export const POST=handler;
export const PATCH=handler;
