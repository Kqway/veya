import type { Metadata } from 'next';
import { ConnectionsScreen } from '@/features/social/components/connections-screen';
export const metadata:Metadata={title:'Запросы людей',robots:{index:false,follow:false}};
export default function Page(){return <ConnectionsScreen/>;}
