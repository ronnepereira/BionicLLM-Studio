(request) => {
  try {
    const accessibleName = element => {
      const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim()
      const labels = [...(element.labels || [])].map(label => {
        const copy = label.cloneNode(true)
        copy.querySelectorAll('input,select,textarea,button').forEach(control => control.remove())
        return copy.textContent.trim()
      }).join(' ')
      return (element.getAttribute('aria-label') || labelledBy || labels || element.getAttribute('placeholder') || element.innerText || element.getAttribute('title') || '').trim().slice(0, 240)
    }
    const visible = element => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    }
    const inViewport = element => {
      const rect = element.getBoundingClientRect()
      return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
    }
    const viewportText = () => {
      if (!document.body) return ''
      const range = document.createRange()
      if (typeof range.getBoundingClientRect !== 'function') return (document.body.innerText || '').slice(0, 16000)
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const parts = []
      let length = 0
      let scanned = 0
      while (walker.nextNode() && scanned++ < 10000 && length < 16000) {
        const node = walker.currentNode
        const text = node.textContent.trim()
        if (!text || !node.parentElement || node.parentElement.closest('script,style,noscript') || !visible(node.parentElement)) continue
        range.selectNodeContents(node)
        const rect = range.getBoundingClientRect()
        if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) continue
        parts.push(text)
        length += text.length
      }
      return parts.join('\n').slice(0, 16000)
    }
    const scrollable = element => {
      const style = getComputedStyle(element)
      return element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 2 && /auto|scroll/.test(style.overflowY)
    }
    const scrollState = area => ({
      x: area.scrollLeft, y: area.scrollTop,
      maxX: Math.max(0, area.scrollWidth - area.clientWidth),
      maxY: Math.max(0, area.scrollHeight - area.clientHeight),
      atTop: area.scrollTop <= 1,
      atBottom: area.scrollTop >= area.scrollHeight - area.clientHeight - 1,
    })
    const targetElement = () => {
      const saved = window.__bionicBrowserSnapshot
      const index = /^e[1-9]\d{0,2}$/.test(request.target || '') ? Number(request.target.slice(1)) - 1 : -1
      const element = saved?.elements[index]
      if (!element?.isConnected || !visible(element)) throw new Error('O elemento mudou ou está oculto. Leia a página novamente.')
      return element
    }
    if (request.action === 'read') {
      if (document.readyState === 'loading') throw new Error('A página ainda está carregando. Aguarde e leia novamente.')
      const controls = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[contenteditable=true],[role=textbox]')].filter(visible)
      const areas = [...document.querySelectorAll('main,section,aside,div,[role=region]')].slice(0, 5000).filter(element => visible(element) && scrollable(element)).slice(0, 20)
      const elements = [...new Set([...controls, ...areas])].sort((a, b) => Number(inViewport(b)) - Number(inViewport(a))).slice(0, 200)
      window.__bionicBrowserSnapshot = { token: request.token, elements }
      return { url: location.href, title: document.title, token: request.token, scrollX, scrollY, pageScroll: scrollState(document.scrollingElement || document.documentElement), viewport: { width: innerWidth, height: innerHeight }, text: viewportText(), elements: elements.map((element, index) => {
        const rect = element.getBoundingClientRect()
        return { ref: `e${index + 1}`, tag: element.tagName.toLowerCase(), type: element.getAttribute('type'), role: element.getAttribute('role'), label: accessibleName(element), focused: element === document.activeElement, scrollable: scrollable(element), scrollTop: scrollable(element) ? element.scrollTop : undefined, scroll: scrollable(element) ? scrollState(element) : undefined, href: element.tagName === 'A' ? element.href : undefined, options: element instanceof HTMLSelectElement ? [...element.options].slice(0, 100).map(option => ({ value: option.value, label: option.label })) : undefined, disabled: element.disabled === true, readOnly: element.readOnly === true, inViewport: rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth }
      }) }
    }
    const saved = window.__bionicBrowserSnapshot
    if (!saved || saved.token !== request.token) throw new Error('A página mudou. Leia a página novamente antes de agir.')
    if (request.action === 'press') {
      if (request.target) targetElement().focus()
      delete window.__bionicBrowserSnapshot
      return { key: request.text }
    } else if (request.action === 'scroll') {
      const area = request.target ? targetElement() : document.scrollingElement || document.documentElement
      const before = scrollState(area)
      area.scrollBy({ left: request.x || 0, top: request.y || 0, behavior: 'instant' })
      const after = scrollState(area)
      const moved = before.x !== after.x || before.y !== after.y
      delete window.__bionicBrowserSnapshot
      return {
        ok: true,
        scroll: { scope: request.target ? 'element' : 'page', moved, before, after },
        message: moved
          ? 'Rolagem realizada. Confira a nova observação.'
          : 'Sem movimento. y positivo rola para baixo, y negativo para cima. Confira atTop/atBottom. Para rolar a página inteira, omita target. Mude a direção ou a área, ou conclua se já encontrou o resultado. Não repita esta ação sem progresso.',
      }
    } else {
      const element = targetElement()
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      if (request.action === 'click') {
        if (element.disabled || element.getAttribute('aria-disabled') === 'true') throw new Error('Este controle está desativado.')
        const rect = element.getBoundingClientRect()
        const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2
        const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2
        const hit = document.elementFromPoint(x, y)
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight || !hit || !element.contains(hit)) throw new Error('O controle está coberto ou fora da área visível. Confira a página antes de clicar.')
        delete window.__bionicBrowserSnapshot
        return { click: { x, y } }
      } else if (request.action === 'type') {
        if (element.disabled || element.readOnly) throw new Error('Este campo não permite edição.')
        element.focus()
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, request.text)
        } else if (element.isContentEditable) element.textContent = request.text
        else throw new Error('O elemento não é um campo de texto.')
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
      } else if (request.action === 'select') {
        if (!(element instanceof HTMLSelectElement) || ![...element.options].some(option => option.value === request.text)) throw new Error('Escolha uma opção válida deste campo.')
        element.value = request.text
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
      } else if (request.action === 'focus') element.focus()
      else throw new Error('Ação de navegador inválida.')
    }
    delete window.__bionicBrowserSnapshot
    return { ok: true, message: 'Ação executada. Confira a observação retornada.' }
  } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
}
