'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignUp } from '@/components/sign-up';
import SignIn from './sign-in';
import { CassetteTape } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

export function Authenticate() {
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');
  const initialTab = tabParam === 'signup' ? 'signup' : 'login';

  const [selectedTab, setSelectedTab] = useState<'login' | 'signup'>(initialTab);
  const [transitioning, setTransitioning] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [contentHeight, setContentHeight] = useState<number>(0);

  // Fix the ref type to be specific to HTMLDivElement
  const signInRef = useRef<HTMLDivElement>(null);
  const signUpRef = useRef<HTMLDivElement>(null);

  // Effect to update height when tabs change or component mounts
  useLayoutEffect(() => {
    if (signInRef.current && selectedTab === 'login') {
      setContentHeight(signInRef.current.offsetHeight);
    } else if (signUpRef.current && selectedTab === 'signup') {
      setContentHeight(signUpRef.current.offsetHeight);
    }
  }, [selectedTab, isMounted]);

  // Set mounted state after component mounts
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Rest of the component remains the same
  const handleTabChange = (value: string) => {
    setTransitioning(true);
    setSelectedTab(value as 'login' | 'signup');
    setTimeout(() => {
      setTransitioning(false);
    }, 300);
  };

  return (
    <Card className="gap-4 overflow-hidden pb-0">
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2">
          <CassetteTape className="h-8 w-8 text-blue-500" />
          <span className="text-2xl font-semibold">Standup</span>
        </div>

        <div>
          <CardTitle>Authentication</CardTitle>
          <CardDescription>Sign in or create an account to get started</CardDescription>
        </div>
      </CardHeader>

      <Tabs
        defaultValue="login"
        value={selectedTab}
        onValueChange={handleTabChange}
        className="w-full"
      >
        <div className="px-6">
          <TabsList className="w-full">
            <TabsTrigger value="login" className="flex-1">
              Sign In
            </TabsTrigger>
            <TabsTrigger value="signup" className="flex-1">
              Sign Up
            </TabsTrigger>
          </TabsList>
        </div>

        <div
          className="transition-height relative overflow-hidden duration-300"
          style={{
            height: contentHeight ? `${contentHeight}px` : 'auto',
            minHeight: '200px', // Provide a default minimum height
          }}
        >
          <div
            ref={signInRef}
            className="absolute top-0 w-full"
            style={{
              opacity: selectedTab === 'login' ? 1 : 0,
              transform: `translateX(${selectedTab === 'login' ? 0 : -20}px)`,
              transition: 'opacity 0.3s, transform 0.3s',
              pointerEvents: selectedTab === 'login' ? 'auto' : 'none',
            }}
          >
            <SignIn />
          </div>

          <div
            ref={signUpRef}
            className="absolute top-0 w-full"
            style={{
              opacity: selectedTab === 'signup' ? 1 : 0,
              transform: `translateX(${selectedTab === 'signup' ? 0 : 20}px)`,
              transition: 'opacity 0.3s, transform 0.3s',
              pointerEvents: selectedTab === 'signup' ? 'auto' : 'none',
            }}
          >
            <SignUp />
          </div>
        </div>
      </Tabs>
    </Card>
  );
}
