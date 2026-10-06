import type { Metadata } from 'next';
import { NowScreen } from '@/features/intent-product/components/now-screen';
export const metadata:Metadata={title:'Intent Network',robots:{index:false,follow:false}};
export default function Page(){return <NowScreen/>;}
