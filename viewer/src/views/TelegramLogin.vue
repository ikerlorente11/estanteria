<template>
  <div class="es-form es-tg-login">
    <p class="es-muted es-small">{{ again ? t('Entra otra vez en «{name}» en este dispositivo.', { name: again }) : t(LIBRARY_TYPES.telegram.hint) }}</p>

    <div v-if="!running" class="es-form-actions">
      <button class="es-btn es-primary" type="button" @click="start('qr')">{{ t('Entrar con QR') }}</button>
      <button class="es-btn" type="button" @click="start('phone')">{{ t('Entrar con el teléfono') }}</button>
      <button class="es-btn" type="button" @click="emit('cancel')">{{ t('Cancelar') }}</button>
    </div>

    <template v-else>
      <!-- the QR: scanned with Telegram on the phone (it renews itself while it waits) -->
      <template v-if="qr && !asking">
        <img class="es-tg-qr" :src="qr" :alt="t('Código QR para entrar en Telegram')" />
        <ol class="es-small es-tg-steps">
          <li>{{ t('Abre Telegram en el móvil.') }}</li>
          <li>{{ t('Ve a Ajustes › Dispositivos › Vincular dispositivo.') }}</li>
          <li>{{ t('Apunta la cámara a este código.') }}</li>
        </ol>
      </template>
      <p v-else-if="!asking" class="es-muted"><span class="es-spin"></span> {{ t('Hablando con Telegram…') }}</p>

      <!-- a step of the phone, or the two-step password -->
      <form v-if="asking" class="es-tg-ask" @submit.prevent="answer">
        <label>{{ asking.label }}
          <input ref="field" v-model="reply" :type="asking.type" :inputmode="asking.inputmode" :autocomplete="asking.autocomplete"
                 :placeholder="asking.placeholder" required autocapitalize="none" spellcheck="false" />
        </label>
        <p v-if="asking.note" class="es-muted es-small">{{ asking.note }}</p>
        <div class="es-form-actions"><button class="es-btn es-primary" type="submit">{{ t('Seguir') }}</button></div>
      </form>

      <p v-if="problem" class="es-source-bad">{{ problem }}</p>
      <div class="es-form-actions"><button class="es-btn" type="button" @click="stop">{{ t('Cancelar') }}</button></div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import { isCancelled } from '../lib/catalogdownloads'
import { t } from '../lib/i18n'
import { LIBRARY_TYPES } from '../lib/libraries'
import { telegramError, type TelegramAccount, type TelegramLink } from '../lib/telegram'
import qrcode from '../vendor/qrcode/qrcode.js'

/** Signing in to Telegram, with a QR or with the phone (and the two-step password, when the account has one).
 * `link`: the library's (a new one, or one whose session this device lost: `again`, its name). */
const props = defineProps<{ link: TelegramLink; again?: string }>()
const emit = defineEmits<{ (e: 'done', account: TelegramAccount): void; (e: 'cancel'): void }>()

interface Ask { label: string; type: string; inputmode?: 'tel' | 'numeric' | 'text'; autocomplete: string; placeholder?: string; note?: string }

const running = ref(false)
const qr = ref('')
const problem = ref('')
const asking = shallowRef<Ask | null>(null)
const reply = ref('')
const field = ref<HTMLInputElement | null>(null)
let waiting: { resolve: (v: string) => void; reject: (e: unknown) => void } | null = null
let stopper: AbortController | null = null

/** asks the person one thing; the answer comes back when they press «Seguir» */
function ask(what: Ask): Promise<string> {
  asking.value = what
  reply.value = ''
  void nextTick(() => field.value?.focus())
  return new Promise((resolve, reject) => { waiting = { resolve, reject } })
}
function answer() {
  const value = reply.value.trim()
  if (!value || !waiting) return
  problem.value = ''
  asking.value = null
  const w = waiting
  waiting = null
  w.resolve(value)
}

function drawQr(link: string) {
  const code = qrcode(0, 'M')
  code.addData(link)
  code.make()
  qr.value = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(code.createSvgTag({ cellSize: 4, margin: 3, scalable: true }))}`
}

async function start(how: 'qr' | 'phone') {
  running.value = true
  problem.value = ''
  qr.value = ''
  stopper = new AbortController()
  const signal = stopper.signal
  try {
    const account = await props.link.login(how, {
      signal,
      qr: drawQr,
      phone: () => ask({ label: t('Tu número de teléfono'), type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '+34 600 000 000',
                         note: t('Con el prefijo del país.') }),
      code: (inApp) => ask({ label: t('El código de Telegram'), type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code',
                             note: inApp ? t('Telegram te lo ha mandado a la app, en otro dispositivo donde tengas la sesión abierta.') : t('Telegram te lo ha mandado por SMS.') }),
      password: (hint) => ask({ label: t('Tu contraseña de verificación en dos pasos'), type: 'password', autocomplete: 'current-password',
                                note: hint ? t('Pista: {hint}', { hint }) : undefined }),
      error: (message) => { problem.value = message },
    })
    emit('done', account)
  } catch (err) {
    if (!isCancelled(err) && !signal.aborted) problem.value = telegramError(err)
  } finally {
    running.value = false
    asking.value = null
    qr.value = ''
  }
}

function stop() {
  stopper?.abort()
  const w = waiting
  waiting = null
  w?.reject(Object.assign(new Error('cancelled'), { cancelled: true }))
  running.value = false
}
onBeforeUnmount(stop)
</script>
