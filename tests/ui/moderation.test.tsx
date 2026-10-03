// @vitest-environment jsdom
import { fireEvent,render,screen,waitFor,cleanup } from '@testing-library/react';
import { afterEach,it,expect,vi } from 'vitest';
import { ModerationScreen } from '@/features/moderation/screen';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('requires separate admin login and clears the secret before showing bounded reports',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce({ok:false,json:async()=>({error:{message:'Требуется авторизованная сессия модератора.'}})})
 .mockResolvedValueOnce({ok:true,json:async()=>({authenticated:true})})
 .mockResolvedValueOnce({ok:true,json:async()=>({reports:[{publicKey:'a'.repeat(24),status:'open',reason:'harassment',text:'Reported concern',createdAt:new Date().toISOString()}]})});
 vi.stubGlobal('fetch',fetch);render(<ModerationScreen/>);
 const input=await screen.findByLabelText('Секретный ключ администратора');fireEvent.change(input,{target:{value:'configured test secret'}});fireEvent.click(screen.getByRole('button',{name:'Войти'}));
 await screen.findByText('Reported concern');expect(screen.getByRole('listitem')).toHaveTextContent('Домогательства · Новая');expect(screen.queryByLabelText('Секретный ключ администратора')).not.toBeInTheDocument();
 expect(fetch.mock.calls[1]![1]).toMatchObject({method:'POST',body:JSON.stringify({secret:'configured test secret'})});
 expect(screen.getByRole('button',{name:'Рассмотреть жалобу'})).toBeInTheDocument();
});
it('provides human restriction controls only after loading report-related evidence',async()=>{
 const report={publicKey:'b'.repeat(24),status:'open',reason:'spam',text:null,createdAt:new Date().toISOString()};
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({authenticated:true})})
 .mockResolvedValueOnce({ok:true,json:async()=>({reports:[report]})})
 .mockResolvedValueOnce({ok:true,json:async()=>({report,evidence:{profiles:[{role:'reporter',label:'Evidence alias'}],posts:[{role:'target',activityLabel:'Chess evidence',interactionMode:'online',format:'one_to_one'}],messages:[{role:'target',text:'Reported message',createdAt:new Date().toISOString()}]}})})
 .mockResolvedValueOnce({ok:true,json:async()=>({report:{...report,status:'resolved'}})});
 vi.stubGlobal('fetch',fetch);render(<ModerationScreen/>);fireEvent.click(await screen.findByRole('button',{name:'Рассмотреть жалобу'}));await screen.findByText('Reported message');expect(screen.getByText('Профиль, на который подана жалоба')).toBeInTheDocument();expect(screen.getByText('Evidence alias')).toBeInTheDocument();expect(screen.getByText('Профиль, на который подана жалоба: Chess evidence · Онлайн · Вдвоём')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Приостановить доступ к профилю'}));await screen.findByRole('status');expect(screen.getByRole('status')).toHaveTextContent('Действие модератора сохранено.');expect(screen.getByText('Статус жалобы: Решена. Материалы были сохранены при подаче жалобы.')).toBeInTheDocument();await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(4));expect(fetch.mock.calls[3]![1]).toMatchObject({method:'PATCH',body:JSON.stringify({moderationStatus:'suspended',status:'resolved'})});
});
it.each([
 new TypeError('Failed to fetch'),
 new SyntaxError('Unexpected token in JSON'),
])('shows Russian operational copy without browser error details: %s',async failure=>{
 const fetchMock=vi.fn().mockResolvedValueOnce({ok:false,json:async()=>({error:{message:'Требуется авторизованная сессия модератора.'}})}).mockRejectedValueOnce(failure);
 vi.stubGlobal('fetch',fetchMock);render(<ModerationScreen/>);
 fireEvent.change(await screen.findByLabelText('Секретный ключ администратора'),{target:{value:'configured test secret'}});
 fireEvent.click(screen.getByRole('button',{name:'Войти'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Модерация временно недоступна. Попробуйте снова.');
 expect(screen.getByRole('alert')).not.toHaveTextContent(failure.message);
});
