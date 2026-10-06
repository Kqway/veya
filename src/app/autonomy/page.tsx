import type { Metadata } from 'next';
import { GoalAutonomy } from '@/features/goals/components/autonomy';
export const metadata:Metadata={title:'Автономия',robots:{index:false,follow:false}};
export default function Page(){return <GoalAutonomy/>;}
