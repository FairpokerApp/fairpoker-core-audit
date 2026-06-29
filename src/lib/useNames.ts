import {useEffect, useMemo, useState} from "react";
import {Chat} from "./setup";
import {ChatRoomEvents} from "./ChatRoom";
import {EventListener} from "./types";
import {usePeerProfiles} from "./peerRisk";

export interface ChatRoomLike {
  listener: EventListener<ChatRoomEvents>;
}

export default function useNames(
  chatRoom: ChatRoomLike = Chat,
) {
  const [chatNames, setChatNames] = useState(new Map<string, string>());
  const peerProfiles = usePeerProfiles();

  useEffect(() => {
    const nameListener = (name: string, whose: string) => {
      setChatNames(prev => {
        const next = new Map(prev);
        next.set(whose, name);
        return next;
      });
    };
    chatRoom.listener.on('name', nameListener);
    return () => {
      chatRoom.listener.off('name', nameListener);
    }
  }, [chatRoom.listener]);

  return useMemo(() => {
    const names = new Map(chatNames);
    for (const profile of Array.from(peerProfiles.values())) {
      const username = profile.accountUsername?.trim();
      if (username) {
        names.set(profile.peerId, username);
      }
    }
    return names;
  }, [chatNames, peerProfiles]);
}
