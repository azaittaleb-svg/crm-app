import { auth } from '../lib/firebase';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

const DRIVE_FOLDER_NAME = 'Sauvegarde App';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export async function getGoogleAccessToken(): Promise<string | null> {
  const provider = new GoogleAuthProvider();
  provider.addScope(DRIVE_SCOPE);

  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    return credential?.accessToken || null;
  } catch (error: any) {
    console.error('Error getting access token:', error);

    // Check if popup was blocked or closed
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
      // For additional scopes after initial login, signInWithRedirect is tricky
      // because it reloads the app state. In a real app we'd handle the redirect result
      // back into the settings page state, but for now we just throw a clearer error
      // so the UI can prompt the user about browser settings or popups.
      throw new Error(
        'La fenêtre de connexion Google a été bloquée ou fermée. Veuillez autoriser les fenêtres surgissantes pour cette application.'
      );
    }

    return null;
  }
}

export async function findOrCreateFolder(accessToken: string): Promise<string> {
  // 1. Search for the folder
  const query = encodeURIComponent(
    `name = '${DRIVE_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await response.json();
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }

  // 2. Create the folder if not found
  const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  const folder = await createResponse.json();
  return folder.id;
}

export async function uploadBackupToDrive(
  accessToken: string,
  folderId: string,
  jsonData: string
): Promise<boolean> {
  const fileName = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: 'application/json',
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([jsonData], { type: 'application/json' }));

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    }
  );

  return response.ok;
}
