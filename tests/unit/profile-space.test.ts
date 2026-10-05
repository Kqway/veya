import { describe, expect, it } from 'vitest';
import { customizationSchema, defaultCustomization, PROFILE_WORLDS } from '@/features/profile-space/schema';

describe('controlled profile customization', () => {
 it('accepts a complete safe default',()=>{
  expect(customizationSchema.parse(defaultCustomization())).toMatchObject({world:'minimal',accent:'coral',avatar:'orbit',tagline:'',status:'',blockOrder:['intent','activities','interests','goals']});
 });
 it.each(PROFILE_WORLDS)('supports world %s',world=>{
  expect(customizationSchema.safeParse({...defaultCustomization(),world}).success).toBe(true);
 });
 it.each([
  {world:'url(https://tracker.example)'}, {accent:'#fff'}, {avatar:'https://tracker.example/a.png'},
  {tagline:'x'.repeat(121)}, {status:'x'.repeat(61)}, {status:'private\0text'},
  {interests:Array.from({length:9},(_,i)=>'interest'+i)}, {interests:['same','same']},
  {interests:['x'.repeat(31)]},{goals:['a','b','c','d']},{goals:['x'.repeat(81)]},
  {blockOrder:['intent','intent','goals','activities']},{blockOrder:['intent']},
  {enabledBlocks:['goals','goals']},{selectedActivities:Array.from({length:7},(_,i)=>'activity'+i)},
  {selectedActivities:['bad key']},{intentPostKey:'internal-id'}, {css:'display:none'},
  {visibility:{status:'stranger'}},
 ])('rejects invalid settings %j',patch=>{
  expect(customizationSchema.safeParse({...defaultCustomization(),...patch}).success).toBe(false);
 });
 it('bounds unknown activities without requiring a catalogue',()=>{
  expect(customizationSchema.safeParse({...defaultCustomization(),selectedActivities:['manual-activity']}).success).toBe(true);
 });
});

import { projectProfileSpace, projectPresentation } from '@/features/profile-space/projection';
import type { Customization } from '@/features/profile-space/schema';
const settings:Customization={...defaultCustomization(),world:'cyber',accent:'violet',avatar:'spark',status:'Secret status',tagline:'Unique global tagline',interests:['private-interest'],goals:['private-goal'],selectedActivities:['chess'],visibility:{status:'everyone',tagline:'connection',intent:'everyone',activities:'connection',interests:'everyone',goals:'everyone'}};
const identity={alias:'Pair Fox',avatarSeed:'random-safe-pair-seed'};
const intent={activityLabel:'Шахматы',interactionMode:'in_person' as const,format:'one_to_one' as const,timeHint:'Подходит сегодня'};
const input={identity,audience:'stranger' as const,privacyMode:'OPEN' as const,customization:settings,contextIntent:intent,activities:[{activityKey:'chess',activityLabel:'Шахматы',count:3}],action:{kind:'interest' as const,key:'h'.repeat(24)},intentOptions:[{publicKey:'p'.repeat(24),activityLabel:'Шахматы'}]};
describe('profile space privacy by projection',()=>{
 it('stranger gets only explicitly permitted OPEN fields',()=>{
  const dto=projectProfileSpace(input);
  expect(dto).toMatchObject({status:settings.status,tagline:null,interests:settings.interests,goals:settings.goals,activities:[],currentIntent:intent});
  expect(dto).not.toHaveProperty('customization');expect(dto).not.toHaveProperty('intentOptions');expect(dto).not.toHaveProperty('activityOptions');
 });
 it('PRIVATE strangers receive no custom free text or global history',()=>{
  expect(projectProfileSpace({...input,privacyMode:'PRIVATE'})).toMatchObject({status:null,tagline:null,activities:[],interests:[],goals:[],currentIntent:intent});
 });
 it('connections receive permitted fields but self visibility stays private',()=>{
  expect(projectProfileSpace({...input,audience:'connection',privacyMode:'PRIVATE',customization:{...settings,visibility:{...settings.visibility,goals:'self'}}})).toMatchObject({status:settings.status,tagline:settings.tagline,activities:input.activities,interests:settings.interests,goals:[]});
 });
 it.each(['stranger','connection'] as const)('INCOGNITO suppresses global personalization for %s',audience=>{
  const dto=projectProfileSpace({...input,audience,privacyMode:'INCOGNITO'});
  expect(dto).toMatchObject({identity,status:null,tagline:null,interests:[],goals:[],activities:[],currentIntent:intent});
  expect(JSON.stringify(dto)).not.toContain('Unique global');expect(dto).not.toHaveProperty('customization');
  expect(projectPresentation(settings,'INCOGNITO',identity)).toEqual(projectPresentation(defaultCustomization(),'INCOGNITO',identity));
 });
 it('self retains complete editor configuration regardless of privacy mode',()=>{
  expect(projectProfileSpace({...input,audience:'self',privacyMode:'INCOGNITO'})).toMatchObject({customization:settings,status:settings.status,tagline:settings.tagline,activities:input.activities,intentOptions:input.intentOptions,activityOptions:input.activities,presentation:{world:'cyber',accent:'violet',avatar:'spark'}});
 });
 it('block order and enablement control only visible projected content',()=>{
  expect(projectProfileSpace({...input,customization:{...settings,enabledBlocks:['goals','intent'],blockOrder:['goals','interests','intent','activities']}})).toMatchObject({blockOrder:['goals','intent'],activities:[],interests:[]});
 });
 it('never serializes input identity IDs, database fields or hidden options',()=>{
  const tainted={...input,profile_id:'internal',availability:['exact'],recovery_key_hash:'secret',identity:{...identity,id:'internal'}};
  const dto=projectProfileSpace(tainted);
  expect(JSON.stringify(dto)).not.toMatch(/internal|exact|secret|profile_id|recovery_key_hash/);
 });
});
