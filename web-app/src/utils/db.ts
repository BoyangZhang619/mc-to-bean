/**
 * IndexedDB 封装 -- perler-db
 * objectStore: patterns (主存储), settings (键值设置)
 *
 * 使用单例连接避免 openDB/close 竞态;
 * 每次写操作同时监听 request 和 transaction 两级错误。
 */

import type { Pattern } from '@/types'

const DB_NAME = 'perler-db'
const DB_VERSION = 1

/**
 * 深拷贝为纯 JSON 对象, 剥离 Vue Proxy/ref 包装。
 * IndexedDB structured clone 不支持 Proxy 对象, 必须先还原为 plain object。
 */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

let dbInstance: IDBDatabase | null = null
let dbPromise: Promise<IDBDatabase> | null = null

function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result

      if (!db.objectStoreNames.contains('patterns')) {
        const store = db.createObjectStore('patterns', { keyPath: 'id' })
        store.createIndex('name', 'name', { unique: false })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' })
      }
    }

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result
      // 监听到连接意外关闭时重置
      dbInstance.onclose = () => {
        dbInstance = null
        dbPromise = null
      }
      resolve(dbInstance!)
    }

    request.onerror = (event) => {
      dbPromise = null
      reject((event.target as IDBOpenDBRequest).error)
    }

    request.onblocked = () => {
      console.warn('[perler-db] 数据库升级被阻塞，请关闭其他标签页后刷新')
    }
  })

  return dbPromise
}

// ==================== Patterns CRUD ====================

export async function getAllPatterns(): Promise<Pattern[]> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('patterns', 'readonly')
    const store = tx.objectStore('patterns')
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      console.error('[perler-db] getAllPatterns 失败:', req.error)
      reject(req.error)
    }
  })
}

export async function getPatternById(id: string): Promise<Pattern | undefined> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('patterns', 'readonly')
    const store = tx.objectStore('patterns')
    const req = store.get(id)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      console.error('[perler-db] getPatternById 失败:', req.error)
      reject(req.error)
    }
  })
}

export async function savePattern(pattern: Pattern): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    let settled = false
    const tx = db.transaction('patterns', 'readwrite')
    const store = tx.objectStore('patterns')

    const req = store.put(toPlain(pattern))

    req.onsuccess = () => {
      if (!settled) {
        settled = true
        resolve()
      }
    }

    req.onerror = () => {
      console.error('[perler-db] savePattern put 失败:', req.error)
      if (!settled) {
        settled = true
        reject(req.error)
      }
    }

    tx.oncomplete = () => {
      // 事务完成: 如果 req 还未 settled, 说明静默成功
      if (!settled) {
        settled = true
        resolve()
      }
    }

    tx.onerror = () => {
      console.error('[perler-db] savePattern 事务失败:', tx.error)
      if (!settled) {
        settled = true
        reject(tx.error)
      }
    }
  })
}

export async function deletePattern(id: string): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    let settled = false
    const tx = db.transaction('patterns', 'readwrite')
    const store = tx.objectStore('patterns')
    const req = store.delete(id)

    req.onsuccess = () => { if (!settled) { settled = true; resolve() } }
    req.onerror = () => {
      console.error('[perler-db] deletePattern 失败:', req.error)
      if (!settled) { settled = true; reject(req.error) }
    }
    tx.oncomplete = () => { if (!settled) { settled = true; resolve() } }
    tx.onerror = () => {
      console.error('[perler-db] deletePattern 事务失败:', tx.error)
      if (!settled) { settled = true; reject(tx.error) }
    }
  })
}

export async function renamePattern(id: string, newName: string): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    let settled = false
    const tx = db.transaction('patterns', 'readwrite')
    const store = tx.objectStore('patterns')

    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const pattern = getReq.result
      if (pattern) {
        pattern.name = newName
        pattern.updatedAt = Date.now()
        const putReq = store.put(toPlain(pattern))
        putReq.onsuccess = () => { if (!settled) { settled = true; resolve() } }
        putReq.onerror = () => {
          console.error('[perler-db] renamePattern put 失败:', putReq.error)
          if (!settled) { settled = true; reject(putReq.error) }
        }
      } else {
        if (!settled) { settled = true; reject(new Error(`图纸 ${id} 不存在`)) }
      }
    }
    getReq.onerror = () => {
      console.error('[perler-db] renamePattern get 失败:', getReq.error)
      if (!settled) { settled = true; reject(getReq.error) }
    }
    tx.oncomplete = () => { if (!settled) { settled = true; resolve() } }
    tx.onerror = () => {
      console.error('[perler-db] renamePattern 事务失败:', tx.error)
      if (!settled) { settled = true; reject(tx.error) }
    }
  })
}

// ==================== Settings ====================

export async function getSetting<T = any>(key: string): Promise<T | undefined> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly')
    const store = tx.objectStore('settings')
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result?.value)
    req.onerror = () => {
      console.error('[perler-db] getSetting 失败:', req.error)
      reject(req.error)
    }
  })
}

export async function saveSetting(key: string, value: any): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    let settled = false
    const tx = db.transaction('settings', 'readwrite')
    const store = tx.objectStore('settings')
    const req = store.put(toPlain({ key, value }))

    req.onsuccess = () => { if (!settled) { settled = true; resolve() } }
    req.onerror = () => {
      console.error('[perler-db] saveSetting 失败:', req.error)
      if (!settled) { settled = true; reject(req.error) }
    }
    tx.oncomplete = () => { if (!settled) { settled = true; resolve() } }
    tx.onerror = () => {
      console.error('[perler-db] saveSetting 事务失败:', tx.error)
      if (!settled) { settled = true; reject(tx.error) }
    }
  })
}

/** 注销数据库连接 (用于测试/调试) */
export function closeDB(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
    dbPromise = null
  }
}
