import path from 'node:path';

export function normalizeImageFolderTemplate(value) {
  if (typeof value !== 'string') throw Object.assign(new Error('Image Folder must be a vault-relative folder'), { status: 400 });
  const template = value.trim().replace(/\/+$/, '');
  if (!template || path.isAbsolute(template) || /[\\\u0000\r\n]/.test(template)
      || template.split('/').some((part) => !part || part === '.' || part === '..')
      || /[{}]/.test(template.replaceAll('{notename}', ''))) {
    throw Object.assign(new Error('Use a relative folder inside the vault, optionally with {notename}; absolute paths and .. are not allowed'), { status: 400 });
  }
  return template;
}
