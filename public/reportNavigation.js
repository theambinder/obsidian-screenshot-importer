export function firstReturnedFolder(folders, returnedNames = []) {
  const names = new Set(returnedNames);
  return folders.find((folder) => names.has(folder.name)) || null;
}
