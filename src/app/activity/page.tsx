import type { Metadata } from 'next';
import { GoalActivity } from '@/features/goals/components/activity';
export const metadata:Metadata={title:'Активность',robots:{index:false,follow:false}};
export default function Page(){return <GoalActivity/>;}
