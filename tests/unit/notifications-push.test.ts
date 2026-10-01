import { describe, expect, it } from 'vitest';
import { pushEndpointSchema, notificationSchema } from '@/features/notifications/schema';
describe('notification projection and push destination validation', () => {
  it('allows only explicit HTTPS browser provider endpoints', () => {
    for (const host of ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']) expect(pushEndpointSchema.safeParse(`https://${host}/push/token`).success).toBe(true);
    for (const endpoint of ['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://localhost/x','https://fcm.googleapis.com.attacker.test/x','https://user@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x','https://updates.push.services.mozilla.com./x','https://web.push.apple.com/x#secret','https://169.254.169.254/x']) expect(pushEndpointSchema.safeParse(endpoint).success).toBe(false);
  });
  it('rejects private fields and arbitrary navigation from public notifications', () => {
    const item={publicKey:'a'.repeat(24),type:'NEW_MESSAGE',createdAt:new Date().toISOString(),readAt:null,href:'/notifications'};
    expect(notificationSchema.safeParse(item).success).toBe(true);
    for(const extra of [{alias:'secret'},{profileId:'uuid'},{body:'secret'},{href:'https://attacker.test'},{href:'//attacker.test'},{href:'/matches/no-key'}]) expect(notificationSchema.safeParse({...item,...extra}).success).toBe(false);
  });
});
