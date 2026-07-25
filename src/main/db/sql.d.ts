// 让 TypeScript 识别 ?raw 形式的资源导入
// 例如：import schemaSql from './schema.sql?raw'
declare module '*.sql?raw' {
  const content: string
  export default content
}

declare module '*.sql' {
  const content: string
  export default content
}

declare module '*.json?raw' {
  const content: string
  export default content
}
