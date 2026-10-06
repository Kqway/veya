import type { Metadata } from 'next';
import { GoalSettings } from '@/features/goals/components/settings';
export const metadata:Metadata={title:'Ваш профиль',robots:{index:false,follow:false}};
export default function Page(){return <GoalSettings/>;}
