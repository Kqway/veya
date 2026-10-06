export type SocialTopic = 'connections' | 'match' | 'notifications' | 'discovery' | 'intents' | 'rooms' | 'goals';
export type SocialInvalidation = { topic: SocialTopic; matchKey?: string };
export const socialTopics: readonly SocialTopic[] = ['connections','match','notifications','discovery','intents','rooms','goals'];
