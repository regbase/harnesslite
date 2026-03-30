import type { UIMessageChunk } from "ai";
import type { PluginAgentPlugin } from "./plugin";

export function extractXmlPlugin({
    tagName,
    system,
    onTagFinish,
}: {
    tagName: string;
    system: string;
    onTagFinish: (params: {content: string, controller: TransformStreamDefaultController<UIMessageChunk>}) => void | Promise<void>;
}): PluginAgentPlugin {
  return {
    name: "extract-xml",
    systemPrompt: () => system,
    uiMessageTransform: () => {
        const openingTag = `<${tagName}>`;
        const closingTag = `<\/${tagName}>`;

        const tagExtractions: Record<
        string,
        {
          isFirstTagContents: boolean;
          isFirstText: boolean;
          afterSwitch: boolean;
          isTagContents: boolean;
          buffer: string;
          idCounter: number;
          textId: string;
          tagContents: string;
        }
      > = {};

      const transformChunk = (chunk: UIMessageChunk, controller: TransformStreamDefaultController<UIMessageChunk>) => {
        if (chunk.type !== "text-delta") {
          controller.enqueue(chunk);
          return;
        }

        if (tagExtractions[chunk.id] == null) {
          tagExtractions[chunk.id] = {
            isFirstTagContents: true,
            isFirstText: true,
            afterSwitch: false,
            isTagContents: false,
            buffer: "",
            tagContents: "",
            idCounter: 0,
            textId: chunk.id,
          };
        }

        const activeExtraction = tagExtractions[chunk.id];

        activeExtraction.buffer += chunk.delta;

        function publish(text: string) {
          if (text.length > 0) {
            if (activeExtraction.isTagContents) {
              activeExtraction.tagContents += text;
            } else {
              controller.enqueue({
                type: "text-delta",
                delta: text,
                id: activeExtraction.textId,
              });
            }
            activeExtraction.afterSwitch = false;

            if (activeExtraction.isTagContents) {
              activeExtraction.isFirstTagContents = false;
            } else {
              activeExtraction.isFirstText = false;
            }
          }
        }

        do {
          const nextTag = activeExtraction.isTagContents
            ? closingTag
            : openingTag;

          const startIndex = getPotentialStartIndex(
            activeExtraction.buffer,
            nextTag,
          );

          // no opening or closing tag found, publish the buffer
          if (startIndex == null) {
            publish(activeExtraction.buffer);
            activeExtraction.buffer = "";
            break;
          }

          // publish text before the tag
          publish(activeExtraction.buffer.slice(0, startIndex));

          const foundFullMatch =
            startIndex + nextTag.length <= activeExtraction.buffer.length;

          if (foundFullMatch) {
            activeExtraction.buffer = activeExtraction.buffer.slice(
              startIndex + nextTag.length,
            );

            // tag part finished:
            if (activeExtraction.isTagContents) {
              onTagFinish({content: activeExtraction.tagContents, controller});
            }

            activeExtraction.isTagContents = !activeExtraction.isTagContents;
            activeExtraction.afterSwitch = true;
          } else {
            activeExtraction.buffer = activeExtraction.buffer.slice(startIndex);
            break;
          }
        } while (true);
      };

        return new TransformStream<UIMessageChunk, UIMessageChunk>({
            transform: transformChunk,
        })
    },
  };
}


function getPotentialStartIndex(
  text: string,
  searchedText: string,
): number | null {
  // Return null immediately if searchedText is empty.
  if (searchedText.length === 0) {
    return null;
  }

  // Check if the searchedText exists as a direct substring of text.
  const directIndex = text.indexOf(searchedText);
  if (directIndex !== -1) {
    return directIndex;
  }

  // Otherwise, look for the largest suffix of "text" that matches
  // a prefix of "searchedText". We go from the end of text inward.
  for (let i = text.length - 1; i >= 0; i--) {
    const suffix = text.substring(i);
    if (searchedText.startsWith(suffix)) {
      return i;
    }
  }

  return null;
}
