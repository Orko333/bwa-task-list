import type { TaskNode } from '../domain/task';
import { http } from './client';

export interface ApiLimits {
  maxDepth: number;
  maxTitleLength: number;
}

export async function fetchTasks(signal?: AbortSignal): Promise<TaskNode[]> {
  const { data } = await http.get<TaskNode[]>('/tasks', { signal });
  return data;
}

export async function fetchLimits(signal?: AbortSignal): Promise<ApiLimits> {
  const { data } = await http.get<ApiLimits>('/meta', { signal });
  return data;
}

export async function createTask(title: string, parentId: string | null): Promise<TaskNode> {
  const { data } = await http.post<TaskNode>('/tasks', { title, parentId });
  return data;
}

export async function renameTask(id: string, title: string): Promise<TaskNode> {
  const { data } = await http.patch<TaskNode>(`/tasks/${id}`, { title });
  return data;
}

export async function deleteTask(id: string): Promise<void> {
  await http.delete(`/tasks/${id}`);
}

/** Returns the whole tree, since one move can renumber and re-level many rows. */
export async function moveTask(
  id: string,
  parentId: string | null,
  position: number,
): Promise<TaskNode[]> {
  const { data } = await http.patch<TaskNode[]>(`/tasks/${id}/move`, { parentId, position });
  return data;
}
