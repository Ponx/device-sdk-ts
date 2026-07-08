import {
  type ClearSignContextType,
  type SolanaLifiContextSuccess,
  type SolanaLifiInstructionMeta,
  type SolanaTransactionDescriptor,
  type SolanaTransactionDescriptorList,
} from "@ledgerhq/context-module";
import { type LoggerPublisherService } from "@ledgerhq/device-management-kit";

import { ProvideInstructionDescriptorCommand } from "@internal/app-binder/command/ProvideInstructionDescriptorCommand";

import { loadCertificate } from "./loadCertificate";
import { type ProvideContextHandler } from "./provideContextTypes";

const HEX_RADIX = 16;

export const provideLifiContext: ProvideContextHandler<
  ClearSignContextType.SOLANA_LIFI
> = async (
  result: SolanaLifiContextSuccess,
  { api, logger, normaliser, transactionBytes },
) => {
  const { descriptors: lifiDescriptors, instructions: instructionsMeta } =
    result.payload;
  const { certificate: swapTemplateCertificate } = result;

  if (!lifiDescriptors) return;

  if (swapTemplateCertificate) {
    await loadCertificate(
      api,
      swapTemplateCertificate,
      "[SignerSolana] provideLifiContext: Failed to send swapTemplateCertificate to device",
    );
  }

  const message = await normaliser.normaliseMessage(transactionBytes);

  logger.debug(
    "[provideLifiContext] Matching transaction instructions to descriptors",
    {
      data: {
        compiledInstructionsCount: message.compiledInstructions.length,
        descriptorKeys: Object.keys(lifiDescriptors),
        instructionsMetaCount: instructionsMeta.length,
      },
    },
  );

  // Each key's array is consumed FIFO: the CAL response orders descriptors to
  // match the template instruction sequence, so popping front gives the right
  // descriptor for each instruction occurrence.
  const queues: SolanaTransactionDescriptorList = Object.fromEntries(
    Object.entries(lifiDescriptors).map(([k, v]) => [k, [...v]]),
  );

  for (const [index, instruction] of message.compiledInstructions.entries()) {
    const programId = message.allKeys[instruction.programIdIndex];
    const programIdStr = programId?.toBase58();

    const descriptor = popMatchingDescriptor(
      programIdStr,
      instruction.data,
      instructionsMeta,
      queues,
      logger,
    );

    logger.debug(
      `[provideLifiContext] Instruction ${index}: ${descriptor ? "matched" : "no match"}`,
      {
        data: {
          index,
          programId: programIdStr,
          hasDescriptor: !!descriptor,
          hasSignature: !!descriptor?.signature,
        },
      },
    );

    if (descriptor?.signature) {
      await api.sendCommand(
        new ProvideInstructionDescriptorCommand({
          dataHex: descriptor.data,
          signatureHex: descriptor.signature,
        }),
      );
    }
  }
};

// Pops the next descriptor for the first matching (program_id, discriminator)
// from the FIFO queues. Callers must pass the same mutable `queues` object
// across iterations so that each pop advances the queue for that key.
function popMatchingDescriptor(
  programIdStr: string | undefined,
  instructionData: Uint8Array,
  instructionsMeta: SolanaLifiInstructionMeta[],
  queues: SolanaTransactionDescriptorList,
  logger: LoggerPublisherService,
): SolanaTransactionDescriptor | undefined {
  if (!programIdStr) return undefined;

  const candidates = instructionsMeta.filter(
    (meta) => meta.program_id === programIdStr,
  );

  if (candidates.length === 0) {
    logger.debug(
      "[popMatchingDescriptor] No instruction metadata found for program",
      { data: { programId: programIdStr } },
    );
    return undefined;
  }

  for (const candidate of candidates) {
    const discriminatorHex = candidate.discriminator_hex ?? "";
    if (!matchesDiscriminator(instructionData, discriminatorHex)) continue;

    const key = `${programIdStr}:${discriminatorHex}`;
    const queue = queues[key];
    if (!queue?.length) continue;

    const descriptor = queue.shift()!;
    logger.debug("[popMatchingDescriptor] Popped descriptor from queue", {
      data: { programId: programIdStr, key, remaining: queue.length },
    });
    return descriptor;
  }

  logger.debug("[popMatchingDescriptor] No matching discriminator found", {
    data: {
      programId: programIdStr,
      instructionDataLength: instructionData.length,
      candidateDiscriminators: candidates.map((c) => c.discriminator_hex ?? ""),
    },
  });
  return undefined;
}

function matchesDiscriminator(
  instructionData: Uint8Array,
  discriminatorHex: string,
): boolean {
  if (discriminatorHex === "") return true;

  const padded =
    discriminatorHex.length % 2 === 0
      ? discriminatorHex
      : "0" + discriminatorHex;
  const discriminatorBytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < padded.length; i += 2) {
    const byteStr = padded.substring(i, i + 2);
    const parsed = Number.parseInt(byteStr, HEX_RADIX);
    if (Number.isNaN(parsed)) {
      return false;
    }
    discriminatorBytes[i / 2] = parsed;
  }

  if (instructionData.length < discriminatorBytes.length) return false;

  return discriminatorBytes.every((byte, i) => instructionData[i] === byte);
}
