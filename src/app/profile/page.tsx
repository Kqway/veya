import type { Metadata } from 'next';
import { ProfileScreen } from '@/features/profile-space/components/profile-screen';
export const metadata:Metadata={title:'Ваше пространство',robots:{index:false,follow:false}};
export default function Page(){return <ProfileScreen/>;}
