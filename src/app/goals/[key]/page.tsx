import type { Metadata } from 'next';
import { GoalDetail } from '@/features/goals/components/detail';
export const metadata:Metadata={title:'Ваша цель',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{key:string}>}){const {key}=await params;return <GoalDetail goalKey={key}/>;}
