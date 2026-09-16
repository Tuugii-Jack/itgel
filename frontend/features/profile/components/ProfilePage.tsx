"use client";

import { PhoneAuthForm } from "@/components/PhoneAuthForm";
import { Card } from "@/components/ui";
import { ProfileShell } from "@/features/profile/components/ProfileShell";
import { ProfilePageSkeleton } from "@/features/profile/components/ProfileSkeletons";
import { useSession } from "@/lib/session";

export function ProfilePage() {
  const session = useSession();

  if (session.loading) {
    return <ProfilePageSkeleton />;
  }

  return (
    <div className='screen pb-12'>
      <div className='px-4 pt-6 lg:hidden'>
        <div className='text-[20px] font-medium'>Миний профайл</div>
      </div>
      {session.me ? <ProfileShell /> : <SignIn />}
    </div>
  );
}

/** Утас + OTP-оор нэвтрэх / бүртгүүлэх. */
function SignIn() {
  return (
    <div className='px-4 pt-6 lg:mx-auto lg:max-w-[420px] lg:px-0 lg:pt-10'>
      <Card className='flex flex-col gap-3 p-4 lg:p-6'>
        <PhoneAuthForm />
      </Card>
    </div>
  );
}
