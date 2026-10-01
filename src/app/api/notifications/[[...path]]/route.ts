import { notificationHandler } from '@/features/notifications/runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{path?:string[]}>};
async function handle(request:Request,context:Context){return notificationHandler()(request,(await context.params).path??[]);}
export {handle as GET,handle as POST,handle as DELETE};
