import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProfileScreen, type ProfileContext } from '@/features/profile-space/components/profile-screen';
export const metadata:Metadata={title:'Пространство для знакомства',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{context:string;key:string}>}){
 const {context,key}=await params;
 if(!['discovery','connection','match'].includes(context)||!/^[A-Za-z0-9_-]{24}$/.test(key))notFound();
 return <ProfileScreen key={`${context}:${key}`} context={context as ProfileContext} contextKey={key}/>;
}
