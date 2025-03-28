'use server';

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import { s3Client, S3_BUCKET } from '@/lib/s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const defaultModelName = 'gemini-2.0-flash-lite';
const premiumModelName = 'gemini-2.0-flash';

const model = genAI.getGenerativeModel({ model: defaultModelName });

const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY || '');

export async function generateContentFromAudio(s3Keys: string[], prompt: string) {
  try {
    const fileDataArray: { fileUri: string; mimeType: string }[] = [];

    for (const s3Key of s3Keys) {
      // Fetch the file from S3
      const command = new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
      });

      const response = await s3Client.send(command);
      const fileData = await response.Body?.transformToByteArray();

      if (!fileData) {
        throw new Error(`Failed to download file from S3 for key: ${s3Key}`);
      }

      // Determine MIME type (hardcoded for now, can be improved)
      const mimeType = 'audio/mp3';

      // Convert Uint8Array to Buffer
      const buffer = Buffer.from(fileData);

      // Upload the file to Google AI File Manager
      const uploadResult = await fileManager.uploadFile(buffer, {
        mimeType: mimeType,
        displayName: s3Key, // Use S3 key as display name
      });

      let file = await fileManager.getFile(uploadResult.file.name);
      while (file.state === FileState.PROCESSING) {
        process.stdout.write('.');
        // Sleep for 1 seconds
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        // Fetch the file from the API again
        file = await fileManager.getFile(uploadResult.file.name);
      }

      if (file.state === FileState.FAILED) {
        throw new Error('Audio processing failed.');
      }

      fileDataArray.push({
        fileUri: uploadResult.file.uri,
        mimeType: mimeType,
      });
    }

    // Generate content using the uploaded files
    const content = [prompt, ...fileDataArray.map((fileData) => ({ fileData }))];
    const result = await model.generateContent(content);
    const text = result.response.text();
    console.log('Generated content:', text);
    return text;
  } catch (error: any) {
    console.error('Error generating content from S3:', error);
    throw new Error(error.message || 'Failed to generate content from S3');
  }
}

export async function getTranscriptionFromAudioFile(
  contentItems: Array<{
    type: 'audiofile' | 'prompt';
    content: string; // S3 key for audiofile or text for prompt
  }>
) {
  try {
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY || '');

    // Process all items in the array, keeping them in the same order
    const processedItems = [];
    let fullPrompt = '';

    for (const item of contentItems) {
      if (item.type === 'prompt') {
        // Add to our accumulated prompt text
        fullPrompt += item.content + '\n\n';
        processedItems.push(item.content);
      } else if (item.type === 'audiofile') {
        // Process the audio file from S3
        const command = new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: item.content, // This is the S3 key
        });

        const response = await s3Client.send(command);
        const fileData = await response.Body?.transformToByteArray();

        if (!fileData) {
          console.warn(`Failed to download file from S3: ${item.content}`);
          continue; // Skip this file
        }

        // Convert Uint8Array to Buffer
        const buffer = Buffer.from(fileData);
        const mimeType = 'audio/mp3';

        // Upload to Google AI File Manager
        const uploadResult = await fileManager.uploadFile(buffer, {
          mimeType: mimeType,
          displayName: item.content,
        });

        let file = await fileManager.getFile(uploadResult.file.name);
        while (file.state === FileState.PROCESSING) {
          process.stdout.write('.');
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          file = await fileManager.getFile(uploadResult.file.name);
        }

        if (file.state === FileState.FAILED) {
          console.warn(`Processing failed for file: ${item.content}`);
          continue;
        }

        // Add the processed file to our items array
        processedItems.push({
          type: 'audiofile',
          fileUri: uploadResult.file.uri,
          mimeType: mimeType,
        });
      }
    }

    const schema = {
      description: `Detailed transcription of the audio file with speaker identification and timestamping.
             The transcription should capture all spoken content accurately.`,
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          timestamp: {
            type: SchemaType.STRING,
            description: `Timestamp of the audio segment in the format MM:SS or HH:MM:SS.
               Should indicate precisely when this segment occurs in the recording.
               For longer recordings, use the HH:MM:SS format.`,
            nullable: false,
          },
          speaker: {
            type: SchemaType.STRING,
            description: `Speaker of the audio segment, preferably using their email if identified.
               Examples:
               - Use "john@example.com" if the speaker's email is known
               - Use "Person {n}" (like "Person 1") if they are not a participant
               - Use their name if they have identified themselves in the meeting recordings
               - If possible, maintain consistency in speaker identification throughout the transcript`,
            nullable: false,
          },
          text: {
            type: SchemaType.STRING,
            description: `The transcribed text of what was spoken during this segment.
               Should include voice inflections, nuances, and speech patterns.
               Capture pauses, interruptions, and non-verbal sounds when relevant.
               Preserve the natural flow of conversation including false starts and corrections.`,
            nullable: false,
          },
        },
        required: [`timestamp`, `speaker`, `text`],
        propertyOrdering: [`timestamp`, `speaker`, `text`],
      },
    };

    const model = genAI.getGenerativeModel({
      model: premiumModelName,
      generationConfig: {
        responseMimeType: 'application/json',
        // @ts-expect-error - Stream response handling requires specific type casting
        responseSchema: schema,
      },
    });

    // Prepare the model content input
    const modelInput = [
      ...processedItems.map((item) =>
        typeof item === 'string'
          ? item
          : {
              fileData: {
                fileUri: (item as any).fileUri,
                mimeType: (item as any).mimeType,
              },
            }
      ),
    ];

    const result = await model.generateContent(modelInput);
    const text = result.response.text();
    console.log('Generated transcription successfully');
    return text;
  } catch (error: any) {
    console.error('Error generating transcription from S3:', error);
    throw new Error(error.message || 'Failed to generate transcription from S3');
  }
}

export async function identifyParticipantsFromAudio(
  contentItems: Array<{
    type: 'audiofile' | 'prompt';
    content: string; // S3 key for audiofile or text for prompt
  }>
): Promise<string[]> {
  try {
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY || '');

    // Process all items in the array, keeping them in the same order
    const processedItems = [];
    let fullPrompt = '';

    for (const item of contentItems) {
      if (item.type === 'prompt') {
        // Add to our accumulated prompt text
        fullPrompt += item.content + '\n\n';
        processedItems.push(item.content);
      } else if (item.type === 'audiofile') {
        // Process the audio file from S3
        const command = new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: item.content, // This is the S3 key
        });

        const response = await s3Client.send(command);
        const fileData = await response.Body?.transformToByteArray();

        if (!fileData) {
          console.warn(`Failed to download file from S3: ${item.content}`);
          continue; // Skip this file
        }

        // Convert Uint8Array to Buffer
        const buffer = Buffer.from(fileData);
        const mimeType = 'audio/mp3';

        // Upload to Google AI File Manager
        const uploadResult = await fileManager.uploadFile(buffer, {
          mimeType: mimeType,
          displayName: item.content,
        });

        let file = await fileManager.getFile(uploadResult.file.name);
        while (file.state === FileState.PROCESSING) {
          process.stdout.write('.');
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          file = await fileManager.getFile(uploadResult.file.name);
        }

        if (file.state === FileState.FAILED) {
          console.warn(`Processing failed for file: ${item.content}`);
          continue;
        }

        // Add the processed file to our items array
        processedItems.push({
          type: 'audiofile',
          fileUri: uploadResult.file.uri,
          mimeType: mimeType,
        });
      }
    }

    const schema = {
      description: 'Array of emails of participants detected in the audio recording',
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.STRING,
        description: 'Email address of a detected participant',
      },
    };

    const model = genAI.getGenerativeModel({
      model: defaultModelName,
      generationConfig: {
        responseMimeType: 'application/json',
        // @ts-expect-error - Stream response handling requires specific type casting
        responseSchema: schema,
      },
    });

    // Prepare the model content input
    const modelInput = [
      ...processedItems.map((item) =>
        typeof item === 'string'
          ? item
          : {
              fileData: {
                fileUri: (item as any).fileUri,
                mimeType: (item as any).mimeType,
              },
            }
      ),
    ];

    const result = await model.generateContent(modelInput);
    const text = result.response.text();
    console.log('Generated participant list successfully');

    // Parse the JSON response to get an array of email strings
    let emails: string[] = [];
    try {
      emails = JSON.parse(text);
      if (!Array.isArray(emails)) {
        throw new Error('Response is not an array');
      }
    } catch (error) {
      console.error('Failed to parse participant emails:', error);
      return [];
    }

    return emails;
  } catch (error: any) {
    console.error('Error identifying participants from audio:', error);
    throw new Error(error.message || 'Failed to identify participants from audio');
  }
}

const outcomePromptsMap = {
  summary: `Summary must not just quote the transcript (unless it makes sense) but provide a concise overview of the main points discussed.`,
  actions: `Action items are tasks or follow-up actions that need to be taken based on the discussion in the transcript. They should be clear, actionable, and ideally assigned to specific individuals or teams. Each action item should include a brief description of the task, the person responsible for it, and any relevant deadlines or context.
if the action items are not requested for a specific person, group them by the person who was tasked for it.
To refer or tag a specific person link their Name to their email.`,
};

export async function generateOutcome(
  transcripts: string[],
  outcomeType: 'summary' | 'actions',
  additionalPrompt?: string,
  focusParticipant?: { id: string; name: string; email: string } | null
) {
  try {
    // Build focus instructions if a participant is specified
    let focusInstructions = '';
    if (focusParticipant) {
      focusInstructions = `
Focus specifically on content relevant to ${focusParticipant.name} (${focusParticipant.email}).
For summaries: Highlight discussions where they were involved, decisions that affect them, and any feedback they provided.
For action items: Emphasize tasks assigned to them or that require their input.
`;
    }

    const prompt = `You are an AI assistant tasked with generating:

${outcomeType} from the list of transcripts.

${outcomePromptsMap[outcomeType]}

${focusInstructions}

Here are the transcripts:
${transcripts.join('\n\n')}

${additionalPrompt ? additionalPrompt + '\n' : ''}
Please provide the ${outcomeType} in markdown format.`;

    const model = genAI.getGenerativeModel({ model: defaultModelName });

    const content = [prompt];
    const result = await model.generateContent(content);
    const text = result.response.text();
    console.log(`Generated ${outcomeType}:`, text);
    return text;
  } catch (error: any) {
    console.error(`Error generating ${outcomeType}:`, error);
    throw new Error(error.message || `Failed to generate ${outcomeType}`);
  }
}
