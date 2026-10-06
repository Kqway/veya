// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfileScreen } from '@/features/profile-space/components/profile-screen';
import { defaultCustomization, type ProfileSpace } from '@/features/profile-space/schema';
import { RecoveryKeyProvider } from '@/features/social/components/recovery-key-provider';
vi.mock('@/features/realtime/client',()=>({useSocialRefresh:()=>({status:'inactive',reconnect:vi.fn()})}));
const space:ProfileSpace={identity:{alias:'Тихий Лис',avatarSeed:'pair-seed'},audience:'stranger',presentation:{world:'midnight',accent:'mint',avatar:'orbit'},status:null,tagline:null,currentIntent:{activityLabel:'Шахматы',interactionMode:'in_person',format:'one_to_one',timeHint:'Compatible today'},activities:[],interests:[],goals:[],blockOrder:['intent'],action:{kind:'interest',key:'h'.repeat(24)}};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('creates an explicit Interested action from the issued context only, then points at requests',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(response({space})).mockResolvedValueOnce(response({status:'pending'}));vi.stubGlobal('fetch',fetcher);
 const user=userEvent.setup();render(<ProfileScreen context="discovery" contextKey={'h'.repeat(24)}/>);
 await user.click(await screen.findByRole('button',{name:'Предложить что-нибудь'}));
 expect(await screen.findByRole('link',{name:'Посмотреть запрос'})).toHaveAttribute('href','/network/connections');
 expect(fetcher.mock.calls[1]![0]).toBe('/api/social/connections');
 expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({handle:'h'.repeat(24)});
 expect(screen.queryByRole('button',{name:'Предложить что-нибудь'})).not.toBeInTheDocument();
});
it.each([['connections','Посмотреть запрос','/network/connections'],['chat','Открыть чат','/m/'+'m'.repeat(24)]] as const)('avoids duplicate connection actions for %s',async(kind,name,href)=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({space:{...space,action:{kind,key:'m'.repeat(24)}}})));
 render(<ProfileScreen context="connection" contextKey={'r'.repeat(24)}/>);
 expect(await screen.findByRole('link',{name})).toHaveAttribute('href',href);
 expect(screen.queryByRole('button',{name:'Предложить что-нибудь'})).not.toBeInTheDocument();
});
it.each([403,404])('renders a generic unavailable context for %s without attribution',async status=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({error:{message:'private internal detail'}},status)));
 render(<ProfileScreen context="match" contextKey={'m'.repeat(24)}/>);
 expect(await screen.findByRole('heading',{name:'Профиль сейчас недоступен'})).toBeVisible();
 expect(screen.queryByText('private internal detail')).not.toBeInTheDocument();
 expect(screen.queryByRole('article')).not.toBeInTheDocument();
});
it('keeps a failed read distinct from unavailable and supports retry',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(response({error:{code:'SERVICE_UNAVAILABLE'}},503)).mockResolvedValueOnce(response({space}));vi.stubGlobal('fetch',fetcher);
 const user=userEvent.setup();render(<ProfileScreen context="discovery" contextKey={'h'.repeat(24)}/>);
 await screen.findByRole('alert');
 expect(screen.queryByRole('heading',{name:'Профиль сейчас недоступен'})).not.toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'Попробовать снова'}));
 expect(await screen.findByRole('heading',{name:'Тихий Лис'})).toBeVisible();
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('does not resurrect a space after the screen has unmounted',async()=>{
 let resolve!:(value:Response)=>void;const pending=new Promise<Response>(r=>{resolve=r;});vi.stubGlobal('fetch',vi.fn().mockReturnValue(pending));
 const view=render(<ProfileScreen context="match" contextKey={'m'.repeat(24)}/>);view.unmount();
 await act(async()=>{resolve(response({space}));});
 expect(screen.queryByText('Тихий Лис')).not.toBeInTheDocument();
});
it('preserves an unsaved space draft while identity or privacy settings are saved',async()=>{
 const profile={alias:'Лис',avatarSeed:'owner-seed',privacyMode:'OPEN',ageBand:null,languages:['ru'],hasRecoveryKey:true};
 const ownSpace:ProfileSpace={...space,identity:profile,audience:'self',customization:defaultCustomization(),action:{kind:'seek',key:null},intentOptions:[],activityOptions:[]};
 const changed={...profile,privacyMode:'PRIVATE'};
 let finishRefresh!:(value:Response)=>void;const refresh=new Promise<Response>(resolve=>{finishRefresh=resolve;});
 const fetcher=vi.fn().mockResolvedValueOnce(response({profile})).mockResolvedValueOnce(response({space:ownSpace})).mockResolvedValueOnce(response({profile:changed})).mockResolvedValueOnce(response({profile:changed})).mockReturnValueOnce(refresh);vi.stubGlobal('fetch',fetcher);
 const user=userEvent.setup();render(<RecoveryKeyProvider><ProfileScreen editor/></RecoveryKeyProvider>);
 await user.type(await screen.findByLabelText('Статус'),'Не потерять этот черновик');
 await user.click(screen.getByText('Приватность, Ключ Veya и управление профилем'));
 await user.selectOptions(screen.getByLabelText('Приватность'),'PRIVATE');
 await user.click(screen.getByRole('button',{name:'Сохранить профиль'}));
 expect(screen.getByLabelText('Статус')).toHaveValue('Не потерять этот черновик');
 await act(async()=>finishRefresh(response({space:ownSpace})));
 expect(screen.getByLabelText('Статус')).toHaveValue('Не потерять этот черновик');
 expect(screen.getByText('Есть несохранённые изменения')).toBeInTheDocument();
});
it('announces a saved customization once, without duplicate live regions',async()=>{
 const profile={alias:'Лис',avatarSeed:'owner-seed',privacyMode:'OPEN',ageBand:null,languages:['ru'],hasRecoveryKey:true};
 const ownSpace:ProfileSpace={...space,identity:profile,audience:'self',customization:defaultCustomization(),action:{kind:'seek',key:null},intentOptions:[],activityOptions:[]};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response({profile})).mockResolvedValueOnce(response({space:ownSpace})).mockResolvedValueOnce(response({space:ownSpace})));
 const user=userEvent.setup();render(<RecoveryKeyProvider><ProfileScreen editor/></RecoveryKeyProvider>);
 await user.type(await screen.findByLabelText('Статус'),'Сохраняю оформление');
 await user.click(screen.getByRole('button',{name:'Сохранить пространство'}));
 const notices=(await screen.findAllByRole('status')).filter(node=>/сохранено/i.test(node.textContent??''));
 expect(notices).toHaveLength(1);expect(notices[0]).toHaveTextContent('Сохранено. Ваше пространство обновлено.');
});
