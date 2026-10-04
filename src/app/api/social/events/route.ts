import { realtimeHandler } from '@/features/realtime/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// End streams before this budget; reconnect repairs state using persisted APIs.
export const maxDuration = 300;
export const GET = realtimeHandler;
