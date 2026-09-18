"use client";

import { useRouter } from "next/navigation";
import { PhoneAuthForm } from "@/components/PhoneAuthForm";
import { Card } from "@/components/ui";
import { ProfileShell } from "@/features/profile/components/ProfileShell";
import { ProfilePageSkeleton } from "@/features/profile/components/ProfileSkeletons";
import { safeNextPath, workspaceHome } from "@/lib/safeNext";
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

function SignIn() {
  const router = useRouter();

  return (
    <div className='px-4 pt-6 lg:mx-auto lg:max-w-[420px] lg:px-0 lg:pt-10'>
      <Card className='flex flex-col gap-3 p-4 lg:p-6'>
        <PhoneAuthForm
          onDone={(workspace) => {
            const next = safeNextPath(
              typeof window === "undefined"
                ? null
                : new URLSearchParams(window.location.search).get("next"),
            );
            if (next) {
              router.replace(next);
              return;
            }
            if (workspace?.user.role) {
              router.replace(workspaceHome(workspace.user.role));
            }
          }}
        />
      </Card>
    </div>
  );
}
