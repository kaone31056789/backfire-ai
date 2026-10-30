"use client";
import { useRecordMode } from "@/components/record-seed";
import { WorkflowMotionSection } from "@/components/workflow-motion";

export default function WorkflowMotionPage() {
  const { ready, record } = useRecordMode();
  if (!ready) return null;
  return <WorkflowMotionSection record={record} />;
}
