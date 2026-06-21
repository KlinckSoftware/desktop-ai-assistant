import { describe, it, expect } from 'vitest'
import { sanitizeSchema } from './toolExec'

describe('sanitizeSchema', () => {
  it('strips keys the model APIs reject, keeps the allowed subset', () => {
    const out = sanitizeSchema({
      type: 'object',
      description: 'd',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
      $schema: 'http://json-schema.org/draft-07/schema#'
    })
    expect(out.additionalProperties).toBeUndefined()
    expect(out.$schema).toBeUndefined()
    expect(out.type).toBe('object')
    expect(out.description).toBe('d')
    expect(out.required).toEqual(['a'])
    expect(out.properties).toEqual({ a: { type: 'string' } })
  })

  it('recurses into nested properties and items', () => {
    const out = sanitizeSchema({
      type: 'object',
      properties: {
        list: { type: 'array', items: { type: 'object', properties: { x: { type: 'number', foo: 1 } } } }
      }
    })
    const props = out.properties as Record<string, Record<string, unknown>>
    const items = props.list.items as Record<string, Record<string, Record<string, unknown>>>
    expect(items.properties.x.foo).toBeUndefined()
    expect(items.properties.x.type).toBe('number')
  })

  it('defaults to an object schema for non-object input', () => {
    expect(sanitizeSchema(null)).toEqual({ type: 'object', properties: {} })
    expect(sanitizeSchema('nope')).toEqual({ type: 'object', properties: {} })
  })

  it('injects a default type when missing', () => {
    expect(sanitizeSchema({ description: 'x' }).type).toBe('object')
  })
})
