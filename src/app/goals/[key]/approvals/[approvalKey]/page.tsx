import type { Metadata } from 'next';
import { GoalDetail } from '@/features/goals/components/detail';
export const metadata:Metadata={title:'Нужно ваше решение',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{key:string;approvalKey:string}>}){const {key,approvalKey}=await params;return <GoalDetail goalKey={key} approvalKey={approvalKey}/>;}
