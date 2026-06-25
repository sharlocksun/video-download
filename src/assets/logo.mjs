function logoSvg() {
  return `
    <svg class="brand-logo" viewBox="0 0 512 512" role="img" aria-label="木辛说石榴树logo">
      <defs>
        <radialGradient id="logoPaper" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stop-color="#fffdf6"/>
          <stop offset="100%" stop-color="#f8f2e8"/>
        </radialGradient>
        <linearGradient id="logoTrunk" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#8a6747"/>
          <stop offset="100%" stop-color="#4b341f"/>
        </linearGradient>
      </defs>
      <circle cx="256" cy="256" r="238" fill="url(#logoPaper)" stroke="#53683d" stroke-width="8"/>
      <circle cx="256" cy="256" r="224" fill="none" stroke="#53683d" stroke-width="4"/>
      <path d="M69 228 C62 270 64 307 78 348" fill="none" stroke="#7b4f31" stroke-width="5" stroke-linecap="round"/>
      <path d="M443 228 C450 270 448 307 434 348" fill="none" stroke="#7b4f31" stroke-width="5" stroke-linecap="round"/>

      <path d="M256 329 C251 274 253 206 257 137" fill="none" stroke="url(#logoTrunk)" stroke-width="23" stroke-linecap="round"/>
      <path d="M253 229 C217 206 177 189 126 177" fill="none" stroke="#66452d" stroke-width="11" stroke-linecap="round"/>
      <path d="M259 218 C296 195 329 174 365 137" fill="none" stroke="#66452d" stroke-width="11" stroke-linecap="round"/>
      <path d="M256 182 C229 158 215 135 209 105" fill="none" stroke="#66452d" stroke-width="8" stroke-linecap="round"/>
      <path d="M264 252 C311 236 351 214 403 207" fill="none" stroke="#66452d" stroke-width="9" stroke-linecap="round"/>
      <path d="M230 260 C201 267 174 289 151 318" fill="none" stroke="#66452d" stroke-width="8" stroke-linecap="round"/>
      <path d="M278 177 C280 143 293 116 316 89" fill="none" stroke="#66452d" stroke-width="8" stroke-linecap="round"/>
      <path d="M217 233 C186 234 154 246 118 274" fill="none" stroke="#66452d" stroke-width="8" stroke-linecap="round"/>
      <path d="M288 229 C323 236 354 257 383 288" fill="none" stroke="#66452d" stroke-width="8" stroke-linecap="round"/>
      <path d="M143 328 C188 322 319 322 369 329" fill="none" stroke="#352617" stroke-width="5" stroke-linecap="round"/>

      <g fill="#587043" stroke="#435737" stroke-width="2">
        <ellipse cx="142" cy="161" rx="14" ry="25" transform="rotate(-13 142 161)"/>
        <ellipse cx="109" cy="201" rx="13" ry="25" transform="rotate(-50 109 201)"/>
        <ellipse cx="151" cy="214" rx="13" ry="24" transform="rotate(42 151 214)"/>
        <ellipse cx="185" cy="161" rx="13" ry="25" transform="rotate(-42 185 161)"/>
        <ellipse cx="208" cy="124" rx="12" ry="25" transform="rotate(-4 208 124)"/>
        <ellipse cx="227" cy="180" rx="12" ry="23" transform="rotate(38 227 180)"/>
        <ellipse cx="252" cy="140" rx="12" ry="23" transform="rotate(24 252 140)"/>
        <ellipse cx="285" cy="112" rx="13" ry="26" transform="rotate(7 285 112)"/>
        <ellipse cx="314" cy="133" rx="12" ry="23" transform="rotate(42 314 133)"/>
        <ellipse cx="345" cy="161" rx="12" ry="24" transform="rotate(-24 345 161)"/>
        <ellipse cx="372" cy="190" rx="12" ry="23" transform="rotate(42 372 190)"/>
        <ellipse cx="399" cy="239" rx="13" ry="25" transform="rotate(69 399 239)"/>
        <ellipse cx="355" cy="247" rx="12" ry="23" transform="rotate(-37 355 247)"/>
        <ellipse cx="318" cy="269" rx="12" ry="23" transform="rotate(35 318 269)"/>
        <ellipse cx="226" cy="270" rx="12" ry="25" transform="rotate(10 226 270)"/>
        <ellipse cx="183" cy="282" rx="12" ry="25" transform="rotate(-17 183 282)"/>
        <ellipse cx="132" cy="253" rx="13" ry="25" transform="rotate(61 132 253)"/>
      </g>

      <g fill="#c7372e" stroke="#af2f29" stroke-width="3">
        <path d="M154 266 C154 246 169 235 185 244 C201 235 216 246 216 266 C216 286 203 299 185 299 C167 299 154 286 154 266Z"/>
        <path d="M176 244 L184 227 L193 244Z"/>
        <path d="M182 226 L188 236 M176 236 L193 232" fill="none" stroke="#af2f29" stroke-width="3" stroke-linecap="round"/>
        <path d="M147 142 C147 125 160 116 174 123 C188 116 201 125 201 142 C201 160 190 171 174 171 C158 171 147 160 147 142Z"/>
        <path d="M166 123 L174 108 L183 123Z"/>
        <path d="M168 108 L176 118 M162 118 L181 115" fill="none" stroke="#af2f29" stroke-width="3" stroke-linecap="round"/>
        <path d="M337 143 C337 126 350 117 364 124 C378 117 391 126 391 143 C391 161 380 172 364 172 C348 172 337 161 337 143Z"/>
        <path d="M356 124 L364 109 L373 124Z"/>
        <path d="M357 110 L367 119 M352 119 L371 116" fill="none" stroke="#af2f29" stroke-width="3" stroke-linecap="round"/>
        <path d="M357 226 C357 208 371 198 386 206 C401 198 415 208 415 226 C415 244 403 256 386 256 C369 256 357 244 357 226Z"/>
        <path d="M378 206 L386 190 L395 206Z"/>
        <path d="M379 190 L389 201 M374 201 L393 198" fill="none" stroke="#af2f29" stroke-width="3" stroke-linecap="round"/>
        <path d="M392 283 C392 270 403 262 414 268 C425 262 436 270 436 283 C436 297 427 306 414 306 C401 306 392 297 392 283Z"/>
        <path d="M407 268 L414 255 L421 268Z"/>
      </g>

      <text x="256" y="424" text-anchor="middle" font-family="KaiTi, STKaiti, SimKai, serif" font-size="72" font-weight="700" fill="#16191c" letter-spacing="18">木辛说</text>
    </svg>
  `;
}

export { logoSvg };
