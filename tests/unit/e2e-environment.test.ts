import{expect,it}from'vitest';
import{isolatedBrowserEnvironment}from'../support/e2e-environment';
it('overrides every external social service and preserves only random test moderator authorization',()=>{
 const poisoned={NODE_ENV:"production" as const,DATABASE_URL:'production-db',DATABASE_URL_UNPOOLED:'production-direct',REALTIME_DATABASE_URL:'production-realtime',DATABASE_SSL_MODE:'verify-full',PUSH_VAPID_PUBLIC_KEY:'production-public',PUSH_VAPID_PRIVATE_KEY:'production-secret',PUSH_VAPID_SUBJECT:'production-owner',RATE_LIMIT_BACKEND:'memory',REALTIME_ENABLED:'false',MODERATION_ADMIN_SECRET:'production-admin',OPENAI_API_KEY:'production-ai',AI_PROVIDER:'openai',VEYA_TEST_ADMIN_SECRET:'test-admin',DB_POOL_MAX:'20'};
 const env=isolatedBrowserEnvironment(poisoned,'postgresql://test@127.0.0.1/isolated');
 expect(env.REALTIME_DATABASE_URL).toBe(env.DATABASE_URL);expect(env.DATABASE_SSL_MODE).toBe('');expect(env.RATE_LIMIT_BACKEND).toBe('postgres');expect(env.REALTIME_ENABLED).toBe('true');expect(env.DB_POOL_MAX).toBe('5');
 for(const key of['DATABASE_URL_UNPOOLED','PUSH_VAPID_PUBLIC_KEY','PUSH_VAPID_PRIVATE_KEY','PUSH_VAPID_SUBJECT','OPENAI_API_KEY'])expect(env[key]).toBe('');
 expect(env.MODERATION_ADMIN_SECRET).toBe('test-admin');expect(env.AI_PROVIDER).toBe('mock');
 expect(JSON.stringify(env)).not.toContain('production-');
});
it('resets inherited maintenance controls for isolated beta journeys',()=>{
 const env=isolatedBrowserEnvironment({NODE_ENV:'test',BETA_SIGNUPS_ENABLED:'false',BETA_SEEKING_ENABLED:'false',BETA_READ_ONLY:'true'},'postgresql://test@127.0.0.1/isolated');
 expect(env).toMatchObject({BETA_SIGNUPS_ENABLED:'true',BETA_SEEKING_ENABLED:'true',BETA_READ_ONLY:'false'});
});
it('strips inherited hosting and cron credentials, enabling Vercel mode only through an explicit test switch',()=>{
 const inherited={NODE_ENV:'test' as const,VERCEL:'1',VERCEL_URL:'production-host',VERCEL_REGION:'production-region',CRON_SECRET:'production-secret'};
 const env=isolatedBrowserEnvironment(inherited,'postgresql://test@127.0.0.1/isolated');
 for(const key of ['VERCEL','VERCEL_URL','VERCEL_REGION','CRON_SECRET'])expect(env[key]).toBe('');
 const enabled=isolatedBrowserEnvironment({...inherited,VEYA_TEST_VERCEL:'1'},'postgresql://test@127.0.0.1/isolated');
 expect(enabled.VERCEL).toBe('1');expect(enabled.CRON_SECRET).toBe('');expect(enabled.VERCEL_REGION).toBe('');
});
