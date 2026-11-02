import { track } from "@/lib/analytics";
import { directMessageSent, roomMessageSent } from "@/lib/product-events";
import { ROOM_GOAL_EVENT, type RoomGoalEventDetail } from "@/lib/room-goal-event";
import { useComposerDictation } from "@/lib/use-composer-dictation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, BookOpen, CircleDot, Clock, Flag, Mic, Paperclip, Plus, Sparkles, Square, Target } from "lucide-react";
import { TeachBar } from "./TeachBar";
import { useTeach } from "@/lib/use-teach";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { writeComputerPanelView } from "@/lib/computer-panel-view";
import { VoiceNoteRecorder, type VoiceRecording } from "./VoiceNoteRecorder";
import { ComposerOutbox } from "./ComposerOutbox";
import { sendOutbox, voiceBlobs } from "@/lib/app-outbox";
import type { OutboxTarget } from "@/lib/send-outbox";
import { voiceNoteFits } from "../../shared/voice-note-limits";
import { voiceNoteVisible } from "@/lib/voice-note";
import { useStore, currentTaskBot, type Bot, type Group, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { useMenuMotion } from "./MenuMotion";
import { activeLocale, t } from "@/lib/i18n";
import { showToast } from "@/lib/toast";
import { useAdvancedMode } from "@/lib/interface-mode";
import { imeComposing, sendKeyLabel, sendsMessage, useSendKey } from "@/lib/send-key";
import {
  appendDraftAttachments,
  changeDraftAttachmentPending,
  prependComposerDraft,
  replaceDraftAttachment,
  useComposerDraft,
  useComposerChannelMode,
  useDraftAttachmentPending,
} from "@/lib/drafts";
import { MentionMenu, type MentionChoice } from "./MentionMenu";
import { personMentionChoices, useMentionPeople } from "@/lib/mention-people";
import { MentionTextarea } from "./MentionTextarea";
import { ComposerAttachments, pathForFile } from "./ComposerAttachments";
import { splitTranscriptCitations, type CitationAttachment } from "@/lib/citations";
import { PlaceChip } from "./PlaceChip";
import {
  appendPastedText,
  handoffAttachmentImagePreview,
  clipboardHasImages,
  clipboardImageFiles,
  composeMessage,
  dataContextFor,
  composerShouldRefocus,
  composerTakesFocusOnOpen,
  imageAttachmentFromFile,
  fileAttachmentFromFile,
  optimisticFileAttachment,
  replyTargetTakesFocus,
  intakeFiles,
  isLongPaste,
  optimisticImageAttachment,
  fitImages,
  imageRoomLeft,
  MESSAGE_IMAGE_MAX_COUNT,
  pasteAttachment,
  releaseAttachmentImagePreview,
  type Attachment,
  type PasteAttachment,
} from "@/lib/composer-attachments";
import { attachmentWords } from "@/lib/composer-attachments";

attachmentWords.tooBig = (name, size) => t("attach.tooBig", { name, size });
attachmentWords.notSupported = (names) => t("attach.notSupported", { names });
attachmentWords.tooManyImages = (names, max) => t("attach.tooManyImages", { names, max });
import { goalCoordinatorForComposer, openTaskWorking, roomRespondersForComposer } from "@/lib/group-routing";
import { CallButton } from "./CallView";
import { GroupCallButton } from "./GroupCallView";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { ComposerReplyStrip } from "./ReplyQuote";
import { escapeCancelsReply } from "@/lib/replies";
import { useThreadRefs } from "./ThreadRefs";
import {
  QueuedComposerMessages,
  composerCanSteerQueuedMessages,
  doubleEnterSteerWindowExpiresAt,
  doubleEnterSteersQueue,
} from "./ComposerQueuedMessages";
import { skillAuthoringEnabled } from "@/lib/feature-flags";
import { mentionChoicesForQuery, mentionQueryAt } from "@/lib/mentions";
import { serializeThreadRefs, threadTokenFromPaste, threadTokenSpacing } from "@/lib/thread-refs";
import {
  composerSlashTrigger,
  goalTextFromComposer,
  isNewThreadCommand,
  replaceComposerSlashTrigger,
  skillSlashCommands,
  matchingSlashCommands,
  type ComposerSlashCommand,
} from "@/lib/composer-commands";
import { useSlashSkills } from "@/lib/use-slash-skills";
import { COMPOSE_TEXT_EVENT } from "@/lib/native-app";
import { SIDEBAR_INLINE, useMediaQuery } from "@/lib/use-media-query";
import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";
import { ComposerPlusButton } from "./ComposerPlusButton";

export function Composer({
  bot: profile,
  group,
  members,
  onEditLast,
  replyTo,
  onClearReply,
  onConsumeReply,
  locked: setupLocked = false,
}: {
  bot?: Bot;
  group?: Group;
  members?: Bot[];
  onEditLast?: () => void;
  replyTo?: Message | null;
  onClearReply?: () => void;
  onConsumeReply?: () => void;
  locked?: boolean;
}) {
  const bot = profile ? currentTaskBot(profile) : undefined;
  const locked = setupLocked || Boolean(bot?.awaitingThreadSnapshot);
  const { state, dispatch } = useStore();
  const { threads, currentBotId } = useThreadRefs();
  const { capabilities } = useDesktopCapabilities();
  const advanced = useAdvancedMode();
  const sendKey = useSendKey();
  const sendLabel = sendKeyLabel(sendKey);
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const threadId = group?.threadId ?? bot?.threadId ?? "";
  const currentGroupTask = group?.tasks?.find((task) => task.threadId === threadId);
  const groupBusyBotId = currentGroupTask?.busyBotId ?? (currentGroupTask?.working ? group?.busyBotId : (group?.threadId === threadId ? group?.busyBotId : null));
  const groupWorking = group ? openTaskWorking(group) : false;
  const busy = group ? Boolean(groupWorking || groupBusyBotId) : Boolean(bot?.busy);
  const steerInstanceId = group
    ? members?.find((member) => member.id === groupBusyBotId)?.modelSelection.instanceId
    : bot?.modelSelection.instanceId;
  const canSteer =
    state.instances.find((i) => i.instanceId === steerInstanceId)?.capabilities?.queueing === true;
  const composerTask = profile?.tasks?.find((task) => task.threadId === threadId);
  const draftId = group
    ? `group:${group.id}:${group.threadId}`
    : `bot:${bot?.id ?? ""}:${bot?.threadId ?? ""}`;
  const [text, setText, attachments, setAttachments] = useComposerDraft(
    draftId,
    !group && bot ? `bot:${bot.id}` : undefined,
  );
  const attachmentPending = useDraftAttachmentPending(draftId);
  const [channelMode, setChannelMode] = useComposerChannelMode(draftId);
  const editText = setText;
  useEffect(() => {
    const onComposeText = (event: Event) => {
      const added = (event as CustomEvent<{ text?: string }>).detail?.text;
      if (!added) return;
      editText(text ? `${text}\n${added}` : added);
      inputRef.current?.focus();
    };
    window.addEventListener(COMPOSE_TEXT_EVENT, onComposeText);
    return () => window.removeEventListener(COMPOSE_TEXT_EVENT, onComposeText);
  }, [editText, text]);
  const editAttachments = setAttachments;
  const addAttachments = useCallback(
    (next: Attachment[]) => {
      appendDraftAttachments(draftId, next);
      if (next.length) showToast(next.length === 1 ? t("toast.attachedOne") : t("toast.attachedMany", { count: next.length }));
    },
    [draftId],
  );
  const removeAttachment = useCallback(
    (id: string) => {
      const removed = attachments.find((attachment) => attachment.id === id);
      if (removed?.kind === "image") releaseAttachmentImagePreview(removed);
      editAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
    },
    [attachments, editAttachments],
  );
  const displayPasteInChatBox = useCallback(
    function displayPasteInChatBox(attachment: PasteAttachment) {
      const nextText = appendPastedText(text, attachment.text);
      editText(nextText);
      editAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
      setCaret(nextText.length);
      setDismissedAt(null);
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(nextText.length, nextText.length);
      });
    },
    [text, editText, editAttachments],
  );
  const { recording, speechError, toggle: toggleMic, stop: stopDictation } = useComposerDictation({
    draftId, text, onText: editText, available: capabilities.dictation.available,
  });
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [dismissedSlashAt, setDismissedSlashAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftIdRef = useRef(draftId);
  // The room panel's Objetivo button: switch this room's composer to goal mode and focus it.
  useEffect(() => {
    if (!group || group.dm) return;
    const onGoal = (event: Event) => {
      if ((event as CustomEvent<RoomGoalEventDetail>).detail?.threadId !== threadId) return;
      setChannelMode("goal");
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener(ROOM_GOAL_EVENT, onGoal);
    return () => window.removeEventListener(ROOM_GOAL_EVENT, onGoal);
  }, [group, threadId, setChannelMode]);
  draftIdRef.current = draftId;
  const caretRef = useRef(0);
  caretRef.current = caret;
  const refocusInput = useCallback(() => {
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled || !composerShouldRefocus(document.activeElement, input)) return;
      const at = Math.min(caretRef.current, input.value.length);
      input.focus();
      input.setSelectionRange(at, at);
    });
  }, []);
  // Touch screens are skipped: focusing there pops the on-screen keyboard over the conversation.
  useEffect(() => {
    if (window.matchMedia?.("(hover: none) and (pointer: coarse)").matches) return;
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled || !composerTakesFocusOnOpen(document.activeElement, input)) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const replyToId = replyTo?.id ?? null;
  const focusedReplyRef = useRef(replyToId);
  useEffect(() => {
    const previous = focusedReplyRef.current;
    focusedReplyRef.current = replyToId;
    if (!replyTargetTakesFocus(previous, replyToId)) return;
    if (window.matchMedia?.("(hover: none) and (pointer: coarse)").matches) return;
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled || !composerTakesFocusOnOpen(document.activeElement, input)) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [replyToId]);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const commandListRef = useRef<HTMLDivElement>(null);

  const botSupportsImages = (candidate?: Bot) =>
    Boolean(
      candidate &&
        state.instances.find((i) => i.instanceId === candidate.modelSelection.instanceId)?.capabilities?.images,
    );
  const imageTargetsSupport = (message: string, mode: "chat" | "goal") => {
    if (!group) return botSupportsImages(bot);
    if (mode === "goal") {
      return botSupportsImages(goalCoordinatorForComposer(message, members ?? [], group) ?? undefined);
    }
    const responders = roomRespondersForComposer(message, members ?? [], group);
    return responders.length > 0 && responders.every(botSupportsImages);
  };
  const typedGoalText = group && !group.dm ? goalTextFromComposer(text) : null;
  const effectiveText = typedGoalText ?? text;
  const effectiveChannelMode = typedGoalText !== null ? "goal" : channelMode;
  const engineSupportsImages = imageTargetsSupport(effectiveText, effectiveChannelMode);

  const slash = composerSlashTrigger(text, caret);
  const locale = activeLocale();
  const slashSkills = useSlashSkills(group ? undefined : bot?.id, Boolean(slash) && slash?.start !== dismissedSlashAt);
  const commandCandidates = useMemo(() => {
    if (!slash || slash.start === dismissedSlashAt) return [];
    const supportsAgents = (candidate?: Bot) =>
      Boolean(
        candidate &&
          state.instances.find(
            (instance) => instance.instanceId === candidate.modelSelection.instanceId,
          )?.capabilities?.agentsMcp,
      );
    const available: ComposerSlashCommand[] = [{
      kind: "command",
      id: "new",
      label: "/new",
      description: t("task.new"),
    }];
    if (group ? !group.dm : bot) available.push({
      kind: "command",
      id: "goal",
      label: "/goal",
      description: t(group ? "composer.command.goalDesc" : "composer.command.goalDirectDesc"),
    });
    if (
      skillAuthoringEnabled(state.config) &&
      (group ? (members ?? []).some(supportsAgents) : supportsAgents(bot))
    ) {
      available.push({
        kind: "command",
        id: "learn",
        label: "/learn",
        description: t("composer.command.learnDesc"),
      });
    }
    if (!group && supportsAgents(bot)) available.push({
      kind: "command",
      id: "setup",
      label: "/setup",
      description: t("composer.command.setupDesc"),
    });
    available.push(...skillSlashCommands(slashSkills));
    return matchingSlashCommands(available, slash.query);
  }, [slash, dismissedSlashAt, group, members, bot, state.config, state.instances, locale, slashSkills]);
  const commandPickerOpen = commandCandidates.length > 0;

  const mention = mentionQueryAt(text, caret);
  const { people: roomPeople, self } = useMentionPeople();
  const candidates = useMemo(() => {
    if (!mention || mention.start === dismissedAt) return [];
    const pool: MentionChoice[] = group
      ? [
          ...(!group.dm ? [{ id: "__everyone__", name: "everyone" }] : []),
          ...(members ?? []).map((member) => ({ id: member.id, name: member.name, bot: member })),
          ...personMentionChoices(roomPeople, self),
        ]
      : state.bots
          .filter((member) => member.id !== bot?.id && !member.hidden)
          .map((member) => ({ id: member.id, name: member.name, bot: member }));
    return mentionChoicesForQuery(pool, mention.query);
  }, [mention, dismissedAt, state.bots, bot?.id, group, members, roomPeople, self]);
  const mentionEveryoneCount = (members ?? []).filter((member) => !member.hidden).length;
  const mentionPickerOpen = candidates.length > 0;
  const commandMotion = useMenuMotion(commandPickerOpen);
  const mentionMotion = useMenuMotion(mentionPickerOpen);

  useEffect(
    () => setHighlight(0),
    [mention?.start, mention?.query, slash?.start, slash?.query],
  );

  useEffect(() => {
    if (!commandPickerOpen) return;
    setHighlight((current) => Math.min(current, commandCandidates.length - 1));
  }, [commandCandidates.length, commandPickerOpen]);

  useEffect(() => {
    if (!commandPickerOpen) return;
    commandListRef.current
      ?.querySelector<HTMLElement>(`[data-command-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, commandPickerOpen]);

  useEffect(() => {
    if (!mentionPickerOpen) return;
    mentionListRef.current
      ?.querySelector<HTMLElement>(`[data-mention-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, mentionPickerOpen]);

  const pickMention = (peer: MentionChoice) => {
    if (!mention) return;
    const after = text.slice(caret);
    const next = `${text.slice(0, mention.start)}@${peer.name} ${after}`;
    editText(next);
    const newCaret = mention.start + peer.name.length + 2;
    setCaret(newCaret);
    setDismissedAt(mention.start);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCaret, newCaret);
    });
  };

  const startNewThread = () => {
    if (group) dispatch({ type: "newGroupTask", groupId: group.id });
    else if (bot) dispatch({ type: "newTask", botId: bot.id });
  };

  const pickCommand = (command: ComposerSlashCommand | undefined) => {
    if (!slash || !command) return;
    if (command.kind === "command" && command.id === "new") {
      editText(replaceComposerSlashTrigger(text, slash, "").text);
      setDismissedSlashAt(null);
      startNewThread();
      return;
    }
    const replacement = command.kind === "skill" ? `${command.label} `
      : command.id === "learn" ? "/learn " : command.id === "setup" ? "/setup " : command.id === "goal" && !group ? "/goal " : "";
    const next = replaceComposerSlashTrigger(text, slash, replacement);
    editText(next.text);
    setCaret(next.caret);
    setDismissedSlashAt(slash.start);
    setChannelMode(command.kind === "command" && command.id === "goal" && group ? "goal" : "chat");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const pendingCount = (state.pendingQueued[threadId] ?? []).length;
  const queuedMessages = state.pendingQueued[threadId] ?? [];
  const canSteerQueued = composerCanSteerQueuedMessages(
    busy,
    locked,
    pendingCount,
  );
  const [steering, setSteering] = useState(false);
  const interruptTurn = () => {
    if (group) dispatch({ type: "interruptGroup", groupId: group.id, threadId });
    else if (bot) dispatch({ type: "interrupt", botId: bot.id, threadId });
  };
  const queueHeadId = queuedMessages[0]?.queueId;
  const steerQueued = () => {
    if (!queueHeadId) return;
    setSteering(true);
    const settle = () => setSteering(false);
    if (group && canSteer) {
      dispatch({ type: "steerGroupQueued", groupId: group.id, threadId, queueId: queueHeadId, onError: settle, onSettled: settle });
    } else if (group) {
      dispatch({ type: "interruptGroup", groupId: group.id, threadId, onError: settle });
    } else if (bot && canSteer) {
      dispatch({ type: "steerQueued", botId: bot.id, threadId, queueId: queueHeadId, onError: settle, onSettled: settle });
    } else if (bot) {
      dispatch({ type: "interrupt", botId: bot.id, threadId, onError: settle });
    }
  };
  useEffect(() => setSteering(false), [threadId, queueHeadId]);
  // Only a confirmed removal hands the words back, so a message that already drained into a turn is never resent.
  const editQueued = (queueId: string) => {
    const queued = queuedMessages.find((item) => item.queueId === queueId);
    if (!queued) return;
    const targetDraftId = draftId;
    const onCancelled = () => {
      const cited = splitTranscriptCitations(queued.text);
      if (cited.display) prependComposerDraft(targetDraftId, cited.display);
      appendDraftAttachments(targetDraftId, cited.citations);
      if (targetDraftId !== draftIdRef.current) return;
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(cited.display.length, cited.display.length);
      });
    };
    if (group) dispatch({ type: "cancelGroupQueued", groupId: group.id, threadId, queueId, onCancelled });
    else if (bot) dispatch({ type: "cancelQueued", botId: bot.id, threadId, queueId, onCancelled });
  };
  const steerAgainUntilRef = useRef(0);
  const prevPendingCountRef = useRef(pendingCount);
  useEffect(() => {
    const expiresAt = doubleEnterSteerWindowExpiresAt(
      prevPendingCountRef.current,
      pendingCount,
      busy,
      canSteer,
    );
    if (expiresAt !== null) steerAgainUntilRef.current = expiresAt;
    prevPendingCountRef.current = pendingCount;
  }, [pendingCount, busy, canSteer]);
  useEffect(() => {
    if (!busy || pendingCount === 0) {
      setSteering(false);
      return;
    }
    if (!steering) return;
    const timeout = window.setTimeout(() => setSteering(false), 20_000);
    return () => window.clearTimeout(timeout);
  }, [busy, pendingCount, steering]);
  const fileInput = useRef<HTMLInputElement>(null);
  // On a phone the composer is one glass line: a separate "+" holds the attachments and the room's goal.
  const phone = !useMediaQuery(SIDEBAR_INLINE, true);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const modeBot = group ? undefined : bot;
  const uploadImage = useCallback(async (file: File): Promise<Attachment | null> => {
    const optimistic = optimisticImageAttachment(file);
    if (!optimistic) return null;
    appendDraftAttachments(draftId, [optimistic]);
    try {
      const completed = await imageAttachmentFromFile(file, optimistic, (progress) => {
        replaceDraftAttachment(draftId, optimistic.id, { ...optimistic, progress });
      });
      if (!completed) {
        replaceDraftAttachment(draftId, optimistic.id, null);
        releaseAttachmentImagePreview(optimistic);
        return null;
      }
      handoffAttachmentImagePreview(completed.path, completed.previewUrl);
      if (!replaceDraftAttachment(draftId, optimistic.id, completed)) {
        releaseAttachmentImagePreview(completed);
      }
      return null;
    } catch (error) {
      replaceDraftAttachment(draftId, optimistic.id, null);
      releaseAttachmentImagePreview(optimistic);
      throw error;
    }
  }, [draftId]);
  // Any other file: a chip with its percentage goes into the draft at once and is swapped for the stored file when the upload ends.
  const uploadFile = useCallback(async (file: File): Promise<"added" | null> => {
    if (file.size === 0) return null;
    const optimistic = optimisticFileAttachment(file);
    appendDraftAttachments(draftId, [optimistic]);
    try {
      const completed = await fileAttachmentFromFile(file, {
        onProgress: (progress) => {
          replaceDraftAttachment(draftId, optimistic.id, { ...optimistic, progress });
        },
      });
      if (!completed) {
        replaceDraftAttachment(draftId, optimistic.id, null);
        return null;
      }
      replaceDraftAttachment(draftId, optimistic.id, { ...completed, id: optimistic.id });
      return "added";
    } catch (error) {
      replaceDraftAttachment(draftId, optimistic.id, null);
      throw error;
    }
  }, [draftId]);
  const pickFiles = async (picked: FileList | null) => {
    if (!picked?.length) return;
    changeDraftAttachmentPending(draftId, true);
    try {
      const { attachments: added, notice } = await intakeFiles(Array.from(picked), {
        allowImages: engineSupportsImages,
        getPath: pathForFile,
        uploadImage,
        uploadFile,
        imageRoom: imageRoomLeft(attachments),
      });
      if (added.length) addAttachments(added);
      if (notice) setAttachmentNotice(notice);
    } finally {
      changeDraftAttachmentPending(draftId, false);
    }
    refocusInput();
  };
  const hasContent = Boolean(effectiveText.trim()) || attachments.length > 0;
  const outboxTarget = (mode: "chat" | "goal"): OutboxTarget | null =>
    group ? { kind: "group", groupId: group.id, mode } : bot ? { kind: "bot", botId: bot.id } : null;
  const sendVoiceNote = async (recording: VoiceRecording) => {
    const target = outboxTarget("chat");
    if (locked || !target) return;
    if (!voiceNoteFits(recording.blob.size)) {
      dispatch({ type: "error", message: t("composer.voiceNote.tooLong") });
      return;
    }
    const sendId = crypto.randomUUID();
    // The recording is on the device before it is in the queue, so a reload never finds an entry without its audio.
    await voiceBlobs.put(sendId, recording.blob);
    sendOutbox.enqueue({ sendId, draftId, target, threadId, text: "", voice: { mime: recording.mime, durationMs: recording.durationMs } });
    track("voice_note_sent", { room: Boolean(group) });
  };
  const send = () => {
    if (locked || attachmentPending) return;
    if (!attachments.length && isNewThreadCommand(text)) {
      editText("");
      startNewThread();
      return;
    }
    if (
      attachments.some((attachment) => attachment.kind === "image") &&
      !imageTargetsSupport(effectiveText, effectiveChannelMode)
    ) {
      dispatch({ type: "error", message: t("composer.error.noImages"), informational: true });
      return;
    }
    const composed = composeMessage(serializeThreadRefs(effectiveText, threads, currentBotId), attachments);
    if (!composed) return;
    stopDictation();
    const target = outboxTarget(effectiveChannelMode);
    if (!target) return;
    const dataContext = dataContextFor(composed, state.computerOpen ? state.dataView : null, !group && bot ? { botId: bot.id, threadId } : undefined);
    sendOutbox.enqueue({
      sendId: crypto.randomUUID(),
      draftId,
      target,
      threadId,
      text,
      requestText: composed,
      replyToId: replyTo?.id,
      ...(dataContext ? { dataContext } : {}),
    });
    if (group) roomMessageSent(effectiveChannelMode, busy);
    else directMessageSent(state.instances, bot?.modelSelection?.instanceId, busy && !canSteer);
    setText("");
    setAttachments([]);
    onConsumeReply?.();
    if (group) setChannelMode("chat");
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = clipboardImageFiles(e.clipboardData);
    if (imageFiles.length > 0 || clipboardHasImages(e.clipboardData)) {
      e.preventDefault();
      if (!engineSupportsImages) {
        dispatch({ type: "error", message: t("composer.error.noImages"), informational: true });
        return;
      }
      if (!imageFiles.length) {
        dispatch({ type: "error", message: t("composer.error.clipboardImage"), informational: true });
        return;
      }
      if (imageFiles.length > 0) {
        const fitted = fitImages(imageFiles, imageRoomLeft(attachments));
        if (fitted.leftOut.length) setAttachmentNotice(attachmentWords.tooManyImages(fitted.leftOut.join(", "), MESSAGE_IMAGE_MAX_COUNT));
        if (!fitted.files.length) return;
        changeDraftAttachmentPending(draftId, true);
        void (async () => {
          try {
            const results = await Promise.allSettled(fitted.files.map(uploadImage));
            for (const result of results) {
              if (result.status === "rejected") {
                dispatch({
                  type: "error",
                  message: result.reason instanceof Error ? result.reason.message : "image upload failed",
                });
              }
            }
          } finally {
            changeDraftAttachmentPending(draftId, false);
          }
        })();
        return;
      }
    }
    const pasted = e.clipboardData.getData("text/plain");
    const reference = threadTokenFromPaste(pasted, threads, currentBotId);
    if (reference) {
      e.preventDefault();
      const start = e.currentTarget.selectionStart ?? text.length;
      const end = e.currentTarget.selectionEnd ?? start;
      const { lead, trail } = threadTokenSpacing(text, start, end);
      const token = lead + reference.token + trail;
      editText(text.slice(0, start) + token + text.slice(end));
      const at = start + token.length;
      setCaret(at);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(at, at);
      });
      return;
    }
    if (!isLongPaste(pasted)) return;
    e.preventDefault();
    const start = e.currentTarget.selectionStart;
    const end = e.currentTarget.selectionEnd;
    if (start !== end) {
      editText(`${text.slice(0, start)}${text.slice(end)}`);
      setCaret(start);
    }
    editAttachments((prev) => [...prev, pasteAttachment(pasted)]);
  };

  const toggleGoal = () => {
    if (typedGoalText !== null) {
      const nextCaret = Math.max(0, caret - (text.length - typedGoalText.length));
      editText(typedGoalText);
      setCaret(nextCaret);
      setChannelMode("chat");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(nextCaret, nextCaret);
      });
      return;
    }
    setChannelMode((current) => current === "goal" ? "chat" : "goal");
  };

  // With something attached, the text sits on its own line above the buttons, the way Grok lays it out.
  const attached = attachments.some((attachment) => attachment.kind !== "citation");
  // "Teach a task": the robot's own browser opens beside the chat and records what the person does (admins, one robot at a time).
  const teachAllowed = useOwnerOrAdmin() === true && Boolean(bot) && !group;
  const teach = useTeach(bot?.id, threadId, teachAllowed);
  const [teachError, setTeachError] = useState<string | null>(null);
  const startTeach = async () => {
    if (!bot || teach.status.recording) return;
    setTeachError(null);
    const result = await teach.start();
    if (!result.ok) {
      setTeachError(result.error || t("teach.startFailed"));
      return;
    }
    writeComputerPanelView(bot.id, "browser");
    dispatch({ type: "toggleComputer", open: true });
  };
  const teachItem: SidebarMenuItem[] = teachAllowed ? [{
    key: "teach",
    label: t("composer.teach"),
    icon: <CircleDot size={16} className="text-danger" />,
    disabled: teach.status.recording,
    onSelect: () => void startTeach(),
  }] : [];
  const attachItem: SidebarMenuItem = { key: "attach", label: t("composer.attach"), icon: <Paperclip size={16} />, onSelect: () => fileInput.current?.click() };
  const plusItems: SidebarMenuItem[] = [
    attachItem,
    ...teachItem,
    ...(group && !group.dm ? [{
      key: "goal",
      label: t("composer.goal.chip"),
      subtitle: t("composer.goal.title"),
      icon: <Flag size={16} />,
      active: effectiveChannelMode === "goal",
      onSelect: toggleGoal,
    } satisfies SidebarMenuItem] : []),
  ];

  return (
    <div className="pointer-events-none relative px-5 pb-3">
      {speechError && (
        <div className="pointer-events-auto mb-2 w-full rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          {speechError}
        </div>
      )}
      {teachError && (
        <div className="pointer-events-auto mb-2 w-full rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          {teachError}
        </div>
      )}
      <div className="pointer-events-auto relative w-full">
        {bot && teachAllowed && (
          <TeachBar status={teach.status} botId={bot.id} advanced={advanced} onStop={() => void teach.stop()} />
        )}
        <ComposerOutbox draftId={draftId} messages={(group ?? bot)?.messages ?? []} />
        {commandMotion.shown && (
          <div
            ref={commandListRef}
            role="listbox"
            aria-label={t("composer.commands.aria")}
            className={cn("absolute bottom-full left-2 z-20 mb-2 max-h-80 w-80 max-w-[calc(100%-1rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-hairline/40 bg-raised shadow-lg", commandMotion.className)} {...commandMotion.exitProps}
          >
            <div className="border-b border-hairline/20 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
              {t("composer.commands.title")}
            </div>
            {commandCandidates.map((command, index) => (
              <button
                key={`${command.kind}:${command.id}`}
                data-command-index={index}
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pickCommand(command)}
                onMouseEnter={() => setHighlight(index)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left",
                  index === highlight ? "bg-raised-hover" : "",
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  {command.kind === "skill" ? (
                    <Sparkles size={15} aria-hidden="true" />
                  ) : command.id === "goal" ? (
                    <Target size={15} aria-hidden="true" />
                  ) : (
                    <BookOpen size={15} aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-accent">{command.label}</span>
                    {command.kind === "skill" && (
                      <span className="shrink-0 rounded-full bg-accent/10 px-1.5 text-[11px] font-medium leading-4 text-accent">{t("composer.command.skillTag")}</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-ink-secondary">
                    {command.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        <MentionMenu listRef={mentionListRef} motion={mentionMotion} choices={candidates} highlight={highlight}
          everyoneCount={mentionEveryoneCount} onPick={pickMention} onHighlight={setHighlight} />
        <ComposerAttachments
          placement="outside"
          items={attachments}
          onAdd={addAttachments}
          onRemove={removeAttachment}
          onChangeCitation={(citation: CitationAttachment) => editAttachments((current) => current.map((attachment) => attachment.id === citation.id ? citation : attachment))}
          onDisplayInChatBox={displayPasteInChatBox}
          allowImages={engineSupportsImages}
          notice={attachmentNotice}
          onNotice={setAttachmentNotice}
          onPendingChange={(pending) => changeDraftAttachmentPending(draftId, pending)}
          uploadImage={uploadImage}
          uploadFile={uploadFile}
        />
        <QueuedComposerMessages
          items={queuedMessages}
          onSteer={canSteerQueued ? steerQueued : undefined}
          steerInterrupts={!canSteer}
          steerMode={group ? "next" : "all"}
          steering={steering}
          onCancel={(queueId) => {
            if (group) dispatch({ type: "cancelGroupQueued", groupId: group.id, threadId, queueId });
            else if (bot) dispatch({ type: "cancelQueued", botId: bot.id, threadId, queueId });
          }}
          onEdit={locked ? undefined : editQueued}
        />
        <div className="relative">
          <div
            aria-hidden
            data-composer-backdrop
            className="pointer-events-none absolute -left-5 -right-5 -bottom-3 top-1/2 bg-app"
          />
        <div data-tour="composer" className="@container/composer relative z-[1] rounded-3xl bg-composer px-2 py-1.5 ring-1 ring-composer-ring">
        <ComposerAttachments
          placement="inside"
          items={attachments}
          onAdd={addAttachments}
          onRemove={removeAttachment}
          onChangeCitation={(citation: CitationAttachment) => editAttachments((current) => current.map((attachment) => attachment.id === citation.id ? citation : attachment))}
          onDisplayInChatBox={displayPasteInChatBox}
          allowImages={engineSupportsImages}
          notice={null}
          onNotice={setAttachmentNotice}
          uploadImage={uploadImage}
          uploadFile={uploadFile}
        />
        {replyTo && <ComposerReplyStrip message={replyTo} fallbackName={bot?.name} onClear={onClearReply} />}
        <div data-composer-row className={cn("flex items-end gap-1 @max-[30rem]/composer:flex-wrap", attached && "flex-wrap")}>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void pickFiles(e.target.files);
              // Reset so picking the same file again still fires onChange.
              e.target.value = "";
            }}
          />
          {!locked && (
            <div data-composer-tools className="flex flex-wrap items-center gap-1">
              {phone || !advanced ? <ComposerPlusButton items={plusItems} label={t("chat.more")} phone={phone} /> : teachItem.length > 0 ? (
                <SidebarPopoverMenu
                  items={[attachItem, ...teachItem]}
                  ariaLabel={t("chat.more")}
                  placement="above"
                  triggerClassName=""
                  triggerTitle={t("chat.more")}
                  renderTrigger={() => (
                    <span data-composer-plus="" className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-control hover:text-ink">
                      <Plus size={18} strokeWidth={2} aria-hidden="true" />
                    </span>
                  )}
                />
              ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                aria-label={t("composer.attach")}
                title={t("composer.attach")}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-control hover:text-ink"
              >
                <Paperclip size={17} />
              </button>
              )}
              {!phone && group && !group.dm && (
                <button
                  type="button"
                  aria-pressed={effectiveChannelMode === "goal"}
                  aria-label={t("composer.goal.aria")}
                  title={t("composer.goal.title")}
                  onClick={toggleGoal}
                  className={cn(
                    "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors",
                    effectiveChannelMode === "goal"
                      ? "border-white/15 bg-white/[0.08] text-ink"
                      : "border-hairline/20 bg-transparent text-ink-secondary hover:bg-raised hover:text-ink",
                  )}
                >
                  {t("composer.goal.chip")}
                </button>
              )}
              {modeBot && !remoteClient && advanced && (
                <PlaceChip
                  bot={modeBot}
                  task={composerTask}
                  live={Boolean(modeBot.busy)}
                  disabled={Boolean(modeBot.busy)}
                  onPin={(surface) => dispatch({ type: "updateTask", botId: modeBot.id, threadId: modeBot.threadId, patch: { surface } })}
                />
              )}
            </div>
          )}
          <MentionTextarea
          wrapperClassName={cn("@max-[30rem]/composer:order-first @max-[30rem]/composer:basis-full", attached && "order-first basis-full")}
          inputRef={inputRef}
          peers={group ? members ?? [] : state.bots.filter((member) => member.id !== bot?.id)}
          everyone={Boolean(group && !group.dm)}
          dir="auto"
          rows={1}
          value={text}
          onChange={(e) => {
            if (recording) stopDictation();
            editText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setDismissedAt(null);
            setDismissedSlashAt(null);
          }}
          onPaste={handlePaste}
          onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            // An input method's confirming Enter and arrows pick its own candidates, not a mention or command.
            if (imeComposing(e.nativeEvent)) return;
            if (commandPickerOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setHighlight((current) =>
                  (current + delta + commandCandidates.length) % commandCandidates.length,
                );
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickCommand(commandCandidates[highlight]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDismissedSlashAt(slash?.start ?? null);
                return;
              }
            }
            if (mentionPickerOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setHighlight((h) => (h + delta + candidates.length) % candidates.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickMention(candidates[highlight]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDismissedAt(mention?.start ?? null);
                return;
              }
            }
            if (onClearReply && escapeCancelsReply(e.nativeEvent, { replying: Boolean(replyTo), recording })) {
              e.preventDefault();
              onClearReply();
              return;
            }
            if (e.key === "ArrowUp" && !hasContent && onEditLast) {
              e.preventDefault();
              onEditLast();
              return;
            }
            if (sendsMessage(e.nativeEvent, sendKey)) {
              e.preventDefault();
              if (
                canSteer &&
                doubleEnterSteersQueue(steerAgainUntilRef.current, Date.now(), pendingCount, hasContent)
              ) {
                steerAgainUntilRef.current = 0;
                steerQueued();
                return;
              }
              send();
            }
            if (e.key === "Escape" && recording) stopDictation();
          }}
          // Not disabled during an upload: a disabled element drops keyboard focus for good. send() refuses while one
          // is pending.
          disabled={locked}
          aria-busy={bot?.awaitingThreadSnapshot || undefined}
          placeholder={
            setupLocked
              ? t("composer.placeholder.locked")
              : attachmentPending
              ? t("composer.placeholder.attaching")
              : recording
              ? t("composer.placeholder.listening")
              : attached && !text
              ? t("composer.placeholder.withAttachment")
              : replyTo && !busy
              ? t("composer.placeholder.reply")
              : t("composer.placeholder.short")
          }
          aria-label={t("composer.placeholder.bot", { name: group ? group.name : (bot?.name ?? "") })}
            className="block max-h-[9rem] min-h-6 w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-[15px] leading-6 placeholder:text-ink-secondary focus:outline-none"
          />
          <div data-composer-actions className={cn("flex items-center gap-1 @max-[30rem]/composer:ml-auto", attached && "ml-auto")}>
          {(advanced || group) && busy && !locked && (
          <button
            onClick={interruptTurn}
            aria-label={t("chat.stopTurn")}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
            title={t("chat.stop")}
          >
            <Square size={14} className="fill-current" />
          </button>
        )}
        {!locked && (!busy || !advanced) && capabilities.dictation.available && (
          <button
            onClick={toggleMic}
            aria-label={recording ? t("composer.dictation.stop") : t("composer.dictation.start")}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              recording
                ? "animate-pulse bg-danger/20 text-danger"
                : advanced ? "text-ink-secondary hover:bg-raised hover:text-ink" : "bg-ink/[0.07] text-ink hover:bg-ink/[0.12]",
            )}
            title={recording ? t("composer.dictation.stopHint") : t("composer.dictation.hint")}
          >
            <Mic size={advanced ? 18 : 16} />
          </button>
        )}
        {voiceNoteVisible({ locked, hasContent, advanced, dictationAvailable: capabilities.dictation.available }) && (
          <VoiceNoteRecorder
            onRecorded={sendVoiceNote}
            onError={(message) => dispatch({ type: "error", message })}
          />
        )}
        {bot && !group && !(phone && hasContent) && <CallButton bot={bot} placement="composer" {...(advanced ? {} : { fill: "var(--color-accent)" })} />}
        {group && !advanced && <GroupCallButton group={group} members={members ?? []} placement="composer" fill="var(--color-accent)" />}
        {hasContent && !locked && (
          <button
            onClick={send}
            data-composer-send=""
            disabled={attachmentPending}
            aria-label={
              busy && canSteer
                  ? t("composer.send.steer")
                  : busy
                    ? t("composer.send.queue")
                    : t("composer.send.message")
            }
            title={
              busy && canSteer
                  ? t("composer.send.steer")
                  : busy
                    ? t("composer.send.queueHint")
                    : `${t("chat.send")} (${sendLabel})`
            }
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full text-white",
              busy && !canSteer
                  ? "bg-raised text-ink-secondary hover:bg-raised-hover"
                  : "bg-accent hover:brightness-110",
            )}
          >
            {busy && !canSteer ? <Clock size={15} /> : <ArrowUp size={17} />}
          </button>
          )}
          </div>
        </div>
        </div>
        </div>
      </div>
    </div>
  );
}
