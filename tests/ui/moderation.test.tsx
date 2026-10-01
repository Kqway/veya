// @vitest-environment jsdom
import { fireEvent,render,screen,waitFor,cleanup } from '@testing-library/react';
import { afterEach,it,expect,vi } from 'vitest';
import { ModerationScreen } from '@/features/moderation/screen';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('requires separate admin login and clears the secret before showing bounded reports',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce({ok:false,json:async()=>({error:{message:'An authorized moderator session is required.'}})})
 .mockResolvedValueOnce({ok:true,json:async()=>({authenticated:true})})
 .mockResolvedValueOnce({ok:true,json:async()=>({reports:[{publicKey:'a'.repeat(24),status:'open',reason:'harassment',text:'Reported concern',createdAt:new Date().toISOString()}]})});
 vi.stubGlobal('fetch',fetch);render(<ModerationScreen/>);
 const input=await screen.findByLabelText('Admin secret');fireEvent.change(input,{target:{value:'configured test secret'}});fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
 await screen.findByText('Reported concern');expect(screen.queryByLabelText('Admin secret')).not.toBeInTheDocument();
 expect(fetch.mock.calls[1]![1]).toMatchObject({method:'POST',body:JSON.stringify({secret:'configured test secret'})});
 expect(screen.getByRole('button',{name:'Review report'})).toBeInTheDocument();
});
it('provides human restriction controls only after loading report-related evidence',async()=>{
 const report={publicKey:'b'.repeat(24),status:'open',reason:'spam',text:null,createdAt:new Date().toISOString()};
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({authenticated:true})})
 .mockResolvedValueOnce({ok:true,json:async()=>({reports:[report]})})
 .mockResolvedValueOnce({ok:true,json:async()=>({report,evidence:{profiles:[],posts:[],messages:[{role:'target',text:'Reported message',createdAt:new Date().toISOString()}]}})})
 .mockResolvedValueOnce({ok:true,json:async()=>({report:{...report,status:'resolved'}})});
 vi.stubGlobal('fetch',fetch);render(<ModerationScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Review report'}));await screen.findByText('Reported message');
 fireEvent.click(screen.getByRole('button',{name:'Suspend reported profile'}));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(4));expect(fetch.mock.calls[3]![1]).toMatchObject({method:'PATCH',body:JSON.stringify({moderationStatus:'suspended',status:'resolved'})});
});
