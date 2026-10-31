/* Avatar do robô: inclua uma vez; liga sozinho todo <svg class="nb-avatar"> da página, inclusive os inseridos depois (React, Vue, innerHTML). */
(function(){var NB_CSS="\n  svg.nb-avatar:root { width: 100%; height: 100%; }\n  .nb-avatar { overflow: hidden; }\n  .nb-js:not(.nb-fora) { will-change: transform; }   /* camada própria: redesenha só o avatar que mexeu */\n  .nb-avatar[data-genero=\"f\"] .nb-m, .nb-avatar:not([data-genero=\"f\"]) .nb-f { display: none; }\n  .nb-avatar[data-genero=\"f\"] .nb-mundo { transform: translate(256px, 256px) scale(.45) translate(-626px, -565px); }\n  .nb-halo { stroke: var(--nb-luz,#ff9a18); stroke-opacity: .3; stroke-width: 10px; paint-order: stroke; }\n  .nb-joias circle { stroke: var(--nb-luz,#ff9a18); stroke-opacity: .3; stroke-width: 10px; paint-order: stroke; }\n  .nb-breath { animation: nb-breath 4.2s ease-in-out infinite; }\n  .nb-bob-head { animation: nb-bob 4.2s ease-in-out -.35s infinite; }\n  .nb-led { animation: nb-pulse 2.8s ease-in-out infinite; }\n  .nb-blink { transform-box: fill-box; transform-origin: center; animation: nb-blink 5.2s infinite; }\n  .nb-js .nb-blink { animation: none; }\n  .nb-eyes-feliz, .nb-eyes-sono { display: none; }\n  .nb-droop { transition: transform .7s ease; }\n  .nb-avatar[data-estado=\"trabalhando\"] .nb-led { animation-duration: .9s; }\n  .nb-avatar[data-estado=\"trabalhando\"] .nb-bob-head { animation: nb-nod 1.8s ease-in-out infinite; }\n  .nb-avatar[data-estado=\"trabalhando\"] .nb-type-L { animation: nb-type .5s ease-in-out infinite alternate; }\n  .nb-avatar[data-estado=\"trabalhando\"] .nb-type-R { animation: nb-type .5s ease-in-out -.25s infinite alternate; }\n  .nb-avatar:not(.nb-js)[data-estado=\"trabalhando\"] .nb-eyes-normal { display: none; }\n  .nb-avatar:not(.nb-js)[data-estado=\"trabalhando\"] .nb-eyes-feliz { display: inline; }\n  .nb-avatar[data-estado=\"ausente\"] .nb-breath { animation: nb-breath-deep 6s ease-in-out infinite; }\n  .nb-avatar[data-estado=\"ausente\"] .nb-led { animation: nb-pulse-slow 6s ease-in-out infinite; }\n  .nb-avatar[data-estado=\"ausente\"]:not(.nb-acordado) .nb-droop { transform: translate(0px, 14px) translate(626px, 740px) rotate(-3deg) translate(-626px, -740px); }\n  .nb-avatar:not(.nb-js)[data-estado=\"ausente\"] .nb-eyes-normal { display: none; }\n  .nb-avatar:not(.nb-js)[data-estado=\"ausente\"] .nb-eyes-sono { display: inline; }\n  .nb-avatar:not(.nb-js)[data-estado=\"ausente\"] [data-nb=\"eyes\"] { opacity: .55; }\n  .nb-avatar:not(.nb-js)[data-estado=\"ausente\"] .nb-blink { animation: none; }\n  .nb-fora, .nb-fora *, .nb-foto { animation: none !important; transition: none !important; }\n\n  /* alerta: precisa de aprovação, mão levantada e pulinho de atenção */\n  .nb-avatar[data-estado=\"alerta\"] .nb-led { animation-duration: 1.2s; }\n  .nb-avatar[data-estado=\"alerta\"] .nb-bob-head { animation: nb-nod 1.6s ease-in-out infinite; }\n  .nb-avatar:not(.nb-js)[data-estado=\"alerta\"] [data-nb=\"uaR\"] { transform: translate(386px, 778px) rotate(24deg) translate(-386px, -778px); }\n  .nb-avatar:not(.nb-js)[data-estado=\"alerta\"] [data-nb=\"faR\"] { transform: translate(215px, 868px) rotate(-150deg) translate(-215px, -868px); }\n\n  /* offline: desligado, tudo apagado e parado, não reage ao mouse */\n  .nb-avatar[data-estado=\"offline\"] { --nb-luz: #3b3e44 !important; }\n  .nb-avatar[data-estado=\"offline\"], .nb-avatar[data-estado=\"offline\"] * { animation: none !important; }\n  .nb-avatar[data-estado=\"offline\"] [data-nb=\"eyes\"] { opacity: .5 !important; }\n  .nb-avatar[data-estado=\"offline\"] .nb-halo, .nb-avatar[data-estado=\"offline\"] .nb-joias circle { stroke-opacity: 0 !important; }\n  .nb-avatar[data-estado=\"offline\"] .nb-brilho-olho { display: none; }\n  \n  .nb-mini [data-nb=\"eyes\"] circle, .nb-mini [data-nb=\"eyes\"] rect { stroke: var(--nb-luz,#ff9a18); stroke-width: 4px; }\n  .nb-mini [data-nb^=\"cheek\"], .nb-mini .nb-brilho-olho { display: none; }\n  .nb-mini .nb-labio { stroke: var(--nb-luz,#ff9a18); stroke-width: 6px; }\n  .nb-mini .nb-tiara-luz { stroke-width: 18px; }\n  .nb-mini .nb-joias circle { stroke: var(--nb-luz,#ff9a18); stroke-opacity: 1; stroke-width: 8px; }\n  .nb-mini .nb-breath, .nb-mini .nb-bob-head, .nb-mini .nb-type-L, .nb-mini .nb-type-R, .nb-mini .nb-led { animation: none !important; }\n  .nb-mini[data-estado=\"ausente\"]:not(.nb-acordado) .nb-led { opacity: .38; }\n  .nb-mini[data-estado=\"trabalhando\"] { animation: nb-m-trab 1.8s ease-in-out 3; }\n  .nb-mini[data-estado=\"alerta\"] { animation: nb-m-alerta 1.6s ease-in-out 3; }\n  .nb-mini[data-estado=\"ausente\"]:not(.nb-acordado) { animation: nb-m-sono 5s ease-in-out 2; transform-origin: 50% 92%; }\n  .nb-mini .nb-droop { transition: none !important; }\n  @media (max-width: 95px) {\n  .nb-avatar [data-nb=\"eyes\"] circle, .nb-avatar [data-nb=\"eyes\"] rect { stroke: var(--nb-luz,#ff9a18); stroke-width: 4px; }\n  .nb-avatar [data-nb^=\"cheek\"], .nb-avatar .nb-brilho-olho { display: none; }\n  .nb-avatar .nb-labio { stroke: var(--nb-luz,#ff9a18); stroke-width: 6px; }\n  .nb-avatar .nb-tiara-luz { stroke-width: 18px; }\n  .nb-avatar .nb-joias circle { stroke: var(--nb-luz,#ff9a18); stroke-opacity: 1; stroke-width: 8px; }\n  .nb-avatar .nb-breath, .nb-avatar .nb-bob-head, .nb-avatar .nb-type-L, .nb-avatar .nb-type-R, .nb-avatar .nb-led { animation: none !important; }\n  .nb-avatar[data-estado=\"ausente\"]:not(.nb-acordado) .nb-led { opacity: .38; }\n  .nb-avatar[data-estado=\"trabalhando\"] { animation: nb-m-trab 1.8s ease-in-out 3; }\n  .nb-avatar[data-estado=\"alerta\"] { animation: nb-m-alerta 1.6s ease-in-out 3; }\n  .nb-avatar[data-estado=\"ausente\"]:not(.nb-acordado) { animation: nb-m-sono 5s ease-in-out 2; transform-origin: 50% 92%; }\n  .nb-avatar .nb-droop { transition: none !important; }\n    .nb-avatar:not(.nb-js) [data-nb^=\"brow\"] { transform: translate(0px, -20px); }\n    .nb-avatar:not(.nb-js)[data-estado=\"trabalhando\"] [data-nb^=\"brow\"] { transform: translate(0px, -29px); }\n    .nb-avatar:not(.nb-js)[data-estado=\"ausente\"] [data-nb^=\"brow\"] { transform: translate(0px, -26px); opacity: .35; }\n  }\n  @keyframes nb-breath { 0%, 100% { transform: translate(626px, 1076px) scale(1, 1) translate(-626px, -1076px); } 50% { transform: translate(626px, 1076px) scale(1.008, .99) translate(-626px, -1076px); } }\n  @keyframes nb-breath-deep { 0%, 100% { transform: translate(626px, 1076px) scale(1, 1) translate(-626px, -1076px); } 45% { transform: translate(626px, 1076px) scale(1.016, .978) translate(-626px, -1076px); } }\n  @keyframes nb-bob { 0%, 100% { transform: translateY(-4px); } 50% { transform: translateY(4px); } }\n  @keyframes nb-nod { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(6px); } }\n  @keyframes nb-type { from { transform: translate(215px, 868px) rotate(-4deg) translate(-215px, -868px); } to { transform: translate(215px, 868px) rotate(5deg) translate(-215px, -868px); } }\n  @keyframes nb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .75; } }\n  @keyframes nb-pulse-slow { 0%, 100% { opacity: .5; } 50% { opacity: .25; } }\n  @keyframes nb-m-trab { 0%, 100% { transform: translateY(0px) rotate(0deg); } 30% { transform: translateY(-1px) rotate(-2deg); } 70% { transform: translateY(-1px) rotate(2deg); } }\n  @keyframes nb-m-alerta { 0%, 55%, 100% { transform: translateY(0px); } 65% { transform: translateY(-3px); } 75% { transform: translateY(0px); } 83% { transform: translateY(-1.5px); } 91% { transform: translateY(0px); } }\n  @keyframes nb-m-sono { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(1.025, .972); } }\n  @keyframes nb-blink { 0%, 93%, 100% { transform: scaleY(1); } 95.5% { transform: scaleY(.12); } }\n  @media (prefers-reduced-motion: reduce) {\n    .nb-breath, .nb-bob-head, .nb-led, .nb-blink, .nb-type-L, .nb-type-R { animation: none !important; }\n  }\n  .nb-avatar:not([data-corpo=\"peito\"]) .nb-corpo-peito { display: none; }\n  .nb-avatar:not([data-corpo=\"cintura\"]) .nb-corpo-cintura { display: none; }\n  .nb-avatar:not([data-corpo=\"capsula\"]) .nb-corpo-capsula { display: none; }\n  .nb-avatar:not([data-corpo=\"robusto\"]) .nb-corpo-robusto { display: none; }\n  .nb-avatar:not([data-corpo=\"esfera\"]) .nb-corpo-esfera { display: none; }\n  .nb-avatar[data-corpo=\"peito\"] .nb-ombro { transform: translate(0px, 0px) translate(476px, 864px) scale(1) translate(-476px, -864px); }\n  .nb-avatar[data-corpo=\"cintura\"] .nb-ombro { transform: translate(20px, 0px) translate(476px, 864px) scale(0.95) translate(-476px, -864px); }\n  .nb-avatar[data-corpo=\"capsula\"] .nb-ombro { transform: translate(46px, 4px) translate(476px, 864px) scale(0.84) translate(-476px, -864px); }\n  .nb-avatar[data-corpo=\"robusto\"] .nb-ombro { transform: translate(-10px, -4px) translate(476px, 864px) scale(1.04) translate(-476px, -864px); }\n  .nb-avatar[data-corpo=\"esfera\"] .nb-ombro { transform: translate(34px, 14px) translate(476px, 864px) scale(0.88) translate(-476px, -864px); }\n  .nb-avatar[data-genero=\"f\"] .nb-ombro { transform: translate(20px, 0px) translate(476px, 864px) scale(0.95) translate(-476px, -864px); }";var NB_T={"defs":"<defs><linearGradient id=\"§led\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-luz,#ff9a18),#fff 22%)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-luz,#ff9a18),#000 8%)\"/></linearGradient><radialGradient id=\"§dot\" cx=\".45\" cy=\".4\" r=\".6\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-luz,#ff9a18),#fff 30%)\"/><stop offset=\"0.7\" style=\"stop-color:var(--nb-luz,#ff9a18)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-luz,#ff9a18),#000 10%)\"/></radialGradient><radialGradient id=\"§brilho-olho\" ><stop offset=\"0\" style=\"stop-color:var(--nb-luz,#ff9a18)\" stop-opacity=\"0.34\"/><stop offset=\"0.55\" style=\"stop-color:var(--nb-luz,#ff9a18)\" stop-opacity=\"0.12\"/><stop offset=\"1\" style=\"stop-color:var(--nb-luz,#ff9a18)\" stop-opacity=\"0\"/></radialGradient><radialGradient id=\"§shell\" cx=\"626\" cy=\"430\" r=\"350\" fx=\"600\" fy=\"360\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#111\"/><stop offset=\"0.62\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 36%,#000)\"/><stop offset=\"0.8\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 50%,#000)\"/><stop offset=\"0.93\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 76%,#000)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 6%)\"/></radialGradient><linearGradient id=\"§shell-rim\" x1=\"0\" y1=\"150\" x2=\"0\" y2=\"766\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 24%)\"/><stop offset=\"0.35\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 6%)\"/><stop offset=\"0.75\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 8%)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 31%)\"/></linearGradient><linearGradient id=\"§chin\" x1=\"0\" y1=\"560\" x2=\"0\" y2=\"766\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 45%,#000)\" stop-opacity=\"0\"/><stop offset=\"0.35\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 62%,#000)\"/><stop offset=\"0.68\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 7%)\"/><stop offset=\"0.9\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 24%)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 9%)\"/></linearGradient><linearGradient id=\"§visor\" x1=\"0\" y1=\"232\" x2=\"0\" y2=\"594\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#0e0e0e\"/><stop offset=\"0.6\" stop-color=\"#0a0a0a\"/><stop offset=\"1\" stop-color=\"#121212\"/></linearGradient><linearGradient id=\"§band\" x1=\"364\" y1=\"0\" x2=\"470\" y2=\"0\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 48%)\" stop-opacity=\"0.95\"/><stop offset=\"0.45\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 34%)\" stop-opacity=\"0.92\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 16%)\" stop-opacity=\"0.85\"/></linearGradient><linearGradient id=\"§hl1\" x1=\"536\" y1=\"241\" x2=\"420\" y2=\"388\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#a8a8a8\"/><stop offset=\"0.5\" stop-color=\"#858585\" stop-opacity=\"0.95\"/><stop offset=\"1\" stop-color=\"#5a5a5a\" stop-opacity=\"0.75\"/></linearGradient><linearGradient id=\"§hl2\" x1=\"740\" y1=\"196\" x2=\"812\" y2=\"446\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#f4f4f4\"/><stop offset=\"0.3\" stop-color=\"#d9d9d9\"/><stop offset=\"0.37\" stop-color=\"#7c7c7c\"/><stop offset=\"1\" stop-color=\"#3a3a3a\" stop-opacity=\"0.5\"/></linearGradient><linearGradient id=\"§pod\" x1=\"326\" y1=\"0\" x2=\"400\" y2=\"0\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" style=\"stop-color:var(--nb-casca,#3a3a3a)\"/><stop offset=\"0.35\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 53%,#000)\"/><stop offset=\"1\" stop-color=\"#121212\"/></linearGradient><linearGradient id=\"§neck\" x1=\"504\" y1=\"0\" x2=\"752\" y2=\"0\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 1%)\"/><stop offset=\"0.2\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 60%,#000)\"/><stop offset=\"0.5\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 41%,#000)\"/><stop offset=\"0.8\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 60%,#000)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 1%)\"/></linearGradient><radialGradient id=\"§torso\" cx=\"590\" cy=\"860\" r=\"290\" fx=\"560\" fy=\"840\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 12%)\"/><stop offset=\"0.45\" style=\"stop-color:var(--nb-casca,#3a3a3a)\"/><stop offset=\"0.8\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 66%,#000)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 45%,#000)\"/></radialGradient><linearGradient id=\"§upper\" x1=\"232\" y1=\"712\" x2=\"332\" y2=\"872\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 9%)\"/><stop offset=\"0.3\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 4%)\"/><stop offset=\"0.62\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 86%,#000)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 48%,#000)\"/></linearGradient><linearGradient id=\"§ball\" x1=\"380\" y1=\"0\" x2=\"446\" y2=\"0\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 66%,#000)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 1%)\"/></linearGradient><linearGradient id=\"§cap\" x1=\"0\" y1=\"712\" x2=\"0\" y2=\"846\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 79%,#000)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 40%,#000)\"/></linearGradient><linearGradient id=\"§cuff\" x1=\"116\" y1=\"900\" x2=\"292\" y2=\"1000\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 17%)\"/><stop offset=\"0.28\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 26%)\"/><stop offset=\"0.6\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 9%)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 79%,#000)\"/></linearGradient><linearGradient id=\"§palm\" x1=\"0\" y1=\"950\" x2=\"0\" y2=\"1040\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 49%)\"/><stop offset=\"0.6\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 32%)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 16%)\"/></linearGradient><linearGradient id=\"§finger\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 16%)\"/><stop offset=\"0.35\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 25%)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-casca,#3a3a3a) 91%,#000)\"/></linearGradient>","defsF":"<linearGradient id=\"§tiara\" x1=\"0\" y1=\"40\" x2=\"0\" y2=\"330\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\"0.45\" stop-color=\"#d9dbe0\"/><stop offset=\"1\" stop-color=\"#8d9098\"/></linearGradient><radialGradient id=\"§dress\" cx=\"580\" cy=\"880\" r=\"300\" fx=\"560\" fy=\"860\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-roupa,color-mix(in srgb,var(--nb-luz,#ff9a18) 48%,#161616)),#fff 16%)\"/><stop offset=\"0.45\" style=\"stop-color:var(--nb-roupa,color-mix(in srgb,var(--nb-luz,#ff9a18) 48%,#161616))\"/><stop offset=\"0.85\" style=\"stop-color:color-mix(in srgb,var(--nb-roupa,color-mix(in srgb,var(--nb-luz,#ff9a18) 48%,#161616)),#000 32%)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-roupa,color-mix(in srgb,var(--nb-luz,#ff9a18) 48%,#161616)),#000 55%)\"/></radialGradient>","ini":"</defs><g class=\"nb-mundo\" transform=\"translate(256 256) scale(.5) translate(-626 -612)\"><g class=\"nb-breath\"><g data-nb=\"body\">","corpo":{"peito":"<g class=\"nb-corpo-peito\"><path d=\"M626 806C722 806 794 822 802 870C810 930 780 1010 732 1042C702 1060 664 1066 626 1066C588 1066 550 1060 520 1042C472 1010 442 930 450 870C458 822 530 806 626 806Z\" fill=\"url(#§torso)\" stroke=\"#0c0c0c\" stroke-width=\"3\"/><path d=\"M488 858C500 830 548 816 602 814C562 830 524 852 504 884C496 896 490 910 488 920C480 900 480 874 488 858Z\" fill=\"#fff\" opacity=\".1\"/><path d=\"M478 988C540 1010 712 1010 774 988\" fill=\"none\" stroke=\"#0c0c0c\" stroke-opacity=\".5\" stroke-width=\"5\" stroke-linecap=\"round\"/><rect x=\"578\" y=\"878\" width=\"96\" height=\"54\" rx=\"20\" style=\"fill:color-mix(in srgb,var(--nb-casca,#3a3a3a) 48%,#000);stroke:#0b0b0b\" stroke-width=\"3\"/><rect x=\"600\" y=\"899\" width=\"52\" height=\"12\" rx=\"6\" fill=\"url(#§led)\" class=\"nb-led nb-halo\"/></g>","cintura":"<g class=\"nb-corpo-cintura\"><path d=\"M626 808C706 808 766 822 772 864C778 900 740 920 740 950C740 986 792 1004 790 1036C788 1060 712 1072 626 1072C540 1072 464 1060 462 1036C460 1004 512 986 512 950C512 920 474 900 480 864C486 822 546 808 626 808Z\" fill=\"url(#§torso)\" stroke=\"#0c0c0c\" stroke-width=\"3\"/><path d=\"M500 858C512 832 556 818 604 816C568 830 534 852 516 882C510 892 504 904 502 912C494 894 494 872 500 858Z\" fill=\"#fff\" opacity=\".1\"/><path d=\"M514 950C562 966 690 966 738 950\" fill=\"none\" stroke=\"#0c0c0c\" stroke-opacity=\".5\" stroke-width=\"5\" stroke-linecap=\"round\"/><path d=\"M468 1034C540 1054 712 1054 784 1034\" fill=\"none\" stroke=\"#0c0c0c\" stroke-opacity=\".5\" stroke-width=\"5\" stroke-linecap=\"round\"/><circle cx=\"626\" cy=\"893\" r=\"22\" style=\"fill:color-mix(in srgb,var(--nb-casca,#3a3a3a) 48%,#000);stroke:#0b0b0b\" stroke-width=\"3\"/><circle cx=\"626\" cy=\"893\" r=\"10\" fill=\"url(#§led)\" class=\"nb-led nb-halo\"/></g>","capsula":"<g class=\"nb-corpo-capsula\"><path d=\"M626 806H626A108 108 0 0 1 734 914V966A108 108 0 0 1 626 1074H626A108 108 0 0 1 518 966V914A108 108 0 0 1 626 806Z\" fill=\"url(#§torso)\" stroke=\"#0c0c0c\" stroke-width=\"3\"/><path d=\"M546 868C552 842 572 826 600 820C580 836 566 856 560 884C556 900 554 916 554 930C544 912 542 888 546 868Z\" fill=\"#fff\" opacity=\".1\"/><path d=\"M522 990C580 1004 672 1004 730 990\" fill=\"none\" stroke=\"#0c0c0c\" stroke-opacity=\".5\" stroke-width=\"5\" stroke-linecap=\"round\"/><rect x=\"604\" y=\"852\" width=\"44\" height=\"104\" rx=\"22\" style=\"fill:color-mix(in srgb,var(--nb-casca,#3a3a3a) 48%,#000);stroke:#0b0b0b\" stroke-width=\"3\"/><rect x=\"620\" y=\"866\" width=\"12\" height=\"76\" rx=\"6\" fill=\"url(#§led)\" class=\"nb-led nb-halo\"/></g>","robusto":"<g class=\"nb-corpo-robusto\"><path d=\"M532 808H720A88 88 0 0 1 808 896V972A88 88 0 0 1 720 1060H532A88 88 0 0 1 444 972V896A88 88 0 0 1 532 808Z\" fill=\"url(#§torso)\" stroke=\"#0c0c0c\" stroke-width=\"3\"/><path d=\"M470 880C474 846 500 824 540 818C512 836 494 860 488 892C486 906 484 920 484 932C474 916 468 898 470 880Z\" fill=\"#fff\" opacity=\".1\"/><path d=\"M450 986C540 1004 712 1004 802 986\" fill=\"none\" stroke=\"#0c0c0c\" stroke-opacity=\".5\" stroke-width=\"5\" stroke-linecap=\"round\"/><path d=\"M626 820V870\" fill=\"none\" stroke=\"#0c0c0c\" stroke-opacity=\".5\" stroke-width=\"5\" stroke-linecap=\"round\"/><rect x=\"556\" y=\"880\" width=\"140\" height=\"58\" rx=\"18\" style=\"fill:color-mix(in srgb,var(--nb-casca,#3a3a3a) 48%,#000);stroke:#0b0b0b\" stroke-width=\"3\"/><rect x=\"574\" y=\"903\" width=\"28\" height=\"12\" rx=\"6\" fill=\"url(#§led)\" class=\"nb-led nb-halo\"/><rect x=\"612\" y=\"903\" width=\"28\" height=\"12\" rx=\"6\" fill=\"url(#§led)\" class=\"nb-led nb-halo\"/><rect x=\"650\" y=\"903\" width=\"28\" height=\"12\" rx=\"6\" fill=\"url(#§led)\" class=\"nb-led nb-halo\"/></g>","esfera":"<g class=\"nb-corpo-esfera\"><path d=\"M490 944A136 136 0 1 1 762 944A136 136 0 1 1 490 944Z\" fill=\"url(#§torso)\" stroke=\"#0c0c0c\" stroke-width=\"3\"/><path d=\"M516 900C528 862 560 836 600 826C572 846 552 872 542 904C536 922 534 940 534 956C520 940 512 920 516 900Z\" fill=\"#fff\" opacity=\".1\"/><path d=\"M494 974C560 1000 692 1000 758 974\" fill=\"none\" stroke=\"#0c0c0c\" stroke-opacity=\".5\" stroke-width=\"5\" stroke-linecap=\"round\"/><circle cx=\"626\" cy=\"900\" r=\"24\" style=\"fill:color-mix(in srgb,var(--nb-casca,#3a3a3a) 48%,#000);stroke:#0b0b0b\" stroke-width=\"3\"/><circle cx=\"626\" cy=\"900\" r=\"13\" fill=\"none\" stroke=\"url(#§led)\" stroke-width=\"6\" class=\"nb-led\"/></g>"},"vestido":"<g class=\"nb-f\"><path d=\"M626 812C704 812 760 826 764 862C768 900 730 924 724 952C770 992 822 1040 836 1078C840 1094 740 1104 626 1104C512 1104 412 1094 416 1078C430 1040 482 992 528 952C522 924 484 900 488 862C492 826 548 812 626 812Z\" fill=\"url(#§dress)\" stroke=\"#0c0c0c\" stroke-width=\"3\"/><path d=\"M560 994L520 1096M600 998L590 1102M652 998L662 1102M692 994L732 1096\" fill=\"none\" stroke=\"#000\" stroke-opacity=\".28\" stroke-width=\"5\" stroke-linecap=\"round\"/><path d=\"M500 860C512 834 556 820 604 818C568 832 534 854 516 884C510 894 504 906 502 914C494 896 494 874 500 860Z\" fill=\"#fff\" opacity=\".12\"/><path d=\"M424 1072C500 1092 752 1092 828 1072\" fill=\"none\" stroke=\"url(#§led)\" stroke-width=\"6\" stroke-linecap=\"round\" class=\"nb-led\"/><path d=\"M544 838C570 870 600 878 626 860C652 878 682 870 708 838\" fill=\"none\" stroke=\"url(#§led)\" stroke-width=\"6\" stroke-linecap=\"round\" class=\"nb-led\"/><path d=\"M528 952C580 970 672 970 724 952\" fill=\"none\" stroke=\"url(#§led)\" stroke-width=\"8\" stroke-linecap=\"round\" class=\"nb-led\"/></g>","cabeca":"<g data-nb=\"neck\"><path d=\"M504 752C504 744 560 737 626 737C692 737 748 744 748 752L752 782C752 800 700 818 626 818C552 818 500 800 500 782Z\" fill=\"url(#§neck)\" stroke=\"#0a0a0a\" stroke-width=\"3\"/><path d=\"M506 754C530 742 580 739 626 739C672 739 722 742 746 754\" fill=\"none\" style=\"stroke:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 16%)\" stroke-opacity=\".6\" stroke-width=\"3\"/><ellipse cx=\"626\" cy=\"752\" rx=\"108\" ry=\"11\" fill=\"#050505\"/><rect x=\"598\" y=\"787\" width=\"56\" height=\"16\" rx=\"8\" fill=\"url(#§led)\" class=\"nb-led nb-halo\"/></g><g class=\"nb-droop\"><g class=\"nb-bob-head\"><g data-nb=\"head\"><path d=\"M358 418 A268 268 0 0 1 894 418 C894 545 854 648 784 706 C742 742 687 764 626 764 C565 764 510 742 468 706 C398 648 358 545 358 418 Z\" fill=\"url(#§shell)\"/><path d=\"M358 418 A268 268 0 0 1 894 418 C894 545 854 648 784 706 C742 742 687 764 626 764 C565 764 510 742 468 706 C398 648 358 545 358 418 Z\" fill=\"url(#§chin)\"/><g data-nb=\"visor\"><path d=\"M386 432 C386 302 492 232 626 232 C760 232 866 302 866 432 C866 512 852 560 824 578 C770 600 700 594 626 594 C552 594 482 600 428 578 C400 560 386 512 386 432 Z\" fill=\"url(#§visor)\"/></g><path d=\"M358 418 A268 268 0 0 1 894 418 C894 545 854 648 784 706 C742 742 687 764 626 764 C565 764 510 742 468 706 C398 648 358 545 358 418 Z\" fill=\"none\" stroke=\"url(#§shell-rim)\" stroke-width=\"5\"/><g data-nb=\"ears\"><g><ellipse cx=\"362\" cy=\"476\" rx=\"34\" ry=\"110\" transform=\"rotate(-8 362 476)\" fill=\"url(#§pod)\" style=\"stroke:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 10%)\" stroke-width=\"3\"/><ellipse cx=\"366\" cy=\"478\" rx=\"22\" ry=\"90\" transform=\"rotate(-8 366 478)\" style=\"fill:color-mix(in srgb,var(--nb-casca,#3a3a3a) 34%,#000)\" stroke=\"#0a0a0a\" stroke-width=\"3\"/><rect x=\"-7\" y=\"-39\" width=\"14\" height=\"78\" rx=\"7\" transform=\"translate(356 453) rotate(-8.5)\" fill=\"url(#§led)\" class=\"nb-led nb-halo\"/></g><g transform=\"matrix(-1 0 0 1 1252 0)\"><ellipse cx=\"362\" cy=\"476\" rx=\"34\" ry=\"110\" transform=\"rotate(-8 362 476)\" fill=\"url(#§pod)\" style=\"stroke:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 10%)\" stroke-width=\"3\"/><ellipse cx=\"366\" cy=\"478\" rx=\"22\" ry=\"90\" transform=\"rotate(-8 366 478)\" style=\"fill:color-mix(in srgb,var(--nb-casca,#3a3a3a) 34%,#000)\" stroke=\"#0a0a0a\" stroke-width=\"3\"/><rect x=\"-7\" y=\"-39\" width=\"14\" height=\"78\" rx=\"7\" transform=\"translate(356 453) rotate(-8.5)\" fill=\"url(#§led)\" class=\"nb-led nb-halo\"/></g></g><path data-nb=\"bandL\" d=\"M378 336C367 385 362 445 366 505C370 565 386 615 412 655C436 692 470 722 532 752C505 732 490 716 480 700C466 678 454 646 442 604C432 566 424 528 416 496C408 460 398 410 378 336Z\" fill=\"url(#§band)\"/><g transform=\"matrix(-1 0 0 1 1252 0)\"><path data-nb=\"bandR\" d=\"M378 336C367 385 362 445 366 505C370 565 386 615 412 655C436 692 470 722 532 752C505 732 490 716 480 700C466 678 454 646 442 604C432 566 424 528 416 496C408 460 398 410 378 336Z\" fill=\"url(#§band)\"/></g>","olhosM":"<g data-nb=\"eyes\" fill=\"url(#§dot)\"><g data-nb=\"sideL\"><ellipse cx=\"503\" cy=\"491\" rx=\"78\" ry=\"48\" fill=\"url(#§brilho-olho)\" class=\"nb-brilho-olho\"/><g data-nb=\"lidsL\"><g class=\"nb-blink\"><g data-nb=\"eyeL\" class=\"nb-eyes-normal\"><circle cx=\"474.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"493.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"512.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"531.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"465\" cy=\"491\" r=\"5.7\"/><circle cx=\"484\" cy=\"491\" r=\"5.7\"/><circle cx=\"503\" cy=\"491\" r=\"5.7\"/><circle cx=\"522\" cy=\"491\" r=\"5.7\"/><circle cx=\"541\" cy=\"491\" r=\"5.7\"/><circle cx=\"465\" cy=\"510\" r=\"5.7\"/><circle cx=\"484\" cy=\"510\" r=\"5.7\"/><circle cx=\"503\" cy=\"510\" r=\"5.7\"/><circle cx=\"522\" cy=\"510\" r=\"5.7\"/><circle cx=\"541\" cy=\"510\" r=\"5.7\"/></g></g></g><g class=\"nb-m\" data-nb=\"browL\"><circle cx=\"465\" cy=\"452\" r=\"4.6\"/><circle cx=\"484\" cy=\"448\" r=\"4.6\"/><circle cx=\"503\" cy=\"446\" r=\"4.6\"/><circle cx=\"522\" cy=\"446\" r=\"4.6\"/><circle cx=\"541\" cy=\"447\" r=\"4.6\"/></g></g><g data-nb=\"sideR\"><ellipse cx=\"749\" cy=\"491\" rx=\"78\" ry=\"48\" fill=\"url(#§brilho-olho)\" class=\"nb-brilho-olho\"/><g data-nb=\"lidsR\"><g class=\"nb-blink\"><g data-nb=\"eyeR\" class=\"nb-eyes-normal\"><circle cx=\"720.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"739.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"758.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"777.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"711\" cy=\"491\" r=\"5.7\"/><circle cx=\"730\" cy=\"491\" r=\"5.7\"/><circle cx=\"749\" cy=\"491\" r=\"5.7\"/><circle cx=\"768\" cy=\"491\" r=\"5.7\"/><circle cx=\"787\" cy=\"491\" r=\"5.7\"/><circle cx=\"711\" cy=\"510\" r=\"5.7\"/><circle cx=\"730\" cy=\"510\" r=\"5.7\"/><circle cx=\"749\" cy=\"510\" r=\"5.7\"/><circle cx=\"768\" cy=\"510\" r=\"5.7\"/><circle cx=\"787\" cy=\"510\" r=\"5.7\"/></g></g></g><g class=\"nb-m\" data-nb=\"browR\"><circle cx=\"787\" cy=\"452\" r=\"4.6\"/><circle cx=\"768\" cy=\"448\" r=\"4.6\"/><circle cx=\"749\" cy=\"446\" r=\"4.6\"/><circle cx=\"730\" cy=\"446\" r=\"4.6\"/><circle cx=\"711\" cy=\"447\" r=\"4.6\"/></g></g></g>","olhosF":"<g data-nb=\"eyes\" fill=\"url(#§dot)\"><g data-nb=\"sideL\"><ellipse cx=\"503\" cy=\"491\" rx=\"78\" ry=\"48\" fill=\"url(#§brilho-olho)\" class=\"nb-brilho-olho\"/><g data-nb=\"lidsL\"><g class=\"nb-blink\"><g data-nb=\"eyeL\" class=\"nb-eyes-normal\"><circle cx=\"474.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"493.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"512.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"531.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"465\" cy=\"491\" r=\"5.7\"/><circle cx=\"484\" cy=\"491\" r=\"5.7\"/><circle cx=\"503\" cy=\"491\" r=\"5.7\"/><circle cx=\"522\" cy=\"491\" r=\"5.7\"/><circle cx=\"541\" cy=\"491\" r=\"5.7\"/><circle cx=\"465\" cy=\"510\" r=\"5.7\"/><circle cx=\"484\" cy=\"510\" r=\"5.7\"/><circle cx=\"503\" cy=\"510\" r=\"5.7\"/><circle cx=\"522\" cy=\"510\" r=\"5.7\"/><circle cx=\"541\" cy=\"510\" r=\"5.7\"/></g><g class=\"nb-f\" data-nb=\"lashL\"><rect x=\"-3.8\" y=\"-14\" width=\"7.6\" height=\"28\" rx=\"3.8\" transform=\"translate(455 461) rotate(-62)\"/><rect x=\"-3.8\" y=\"-14\" width=\"7.6\" height=\"28\" rx=\"3.8\" transform=\"translate(463 450) rotate(-38)\"/><rect x=\"-3.8\" y=\"-14\" width=\"7.6\" height=\"28\" rx=\"3.8\" transform=\"translate(474 444) rotate(-14)\"/></g></g></g><g class=\"nb-f\" data-nb=\"cheekL\" opacity=\".45\"><circle cx=\"458\" cy=\"534\" r=\"4.2\"/><circle cx=\"469\" cy=\"534\" r=\"4.2\"/><circle cx=\"480\" cy=\"534\" r=\"4.2\"/><circle cx=\"463.5\" cy=\"544\" r=\"4.2\"/><circle cx=\"474.5\" cy=\"544\" r=\"4.2\"/></g></g><g data-nb=\"sideR\"><ellipse cx=\"749\" cy=\"491\" rx=\"78\" ry=\"48\" fill=\"url(#§brilho-olho)\" class=\"nb-brilho-olho\"/><g data-nb=\"lidsR\"><g class=\"nb-blink\"><g data-nb=\"eyeR\" class=\"nb-eyes-normal\"><circle cx=\"720.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"739.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"758.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"777.5\" cy=\"472\" r=\"5.7\"/><circle cx=\"711\" cy=\"491\" r=\"5.7\"/><circle cx=\"730\" cy=\"491\" r=\"5.7\"/><circle cx=\"749\" cy=\"491\" r=\"5.7\"/><circle cx=\"768\" cy=\"491\" r=\"5.7\"/><circle cx=\"787\" cy=\"491\" r=\"5.7\"/><circle cx=\"711\" cy=\"510\" r=\"5.7\"/><circle cx=\"730\" cy=\"510\" r=\"5.7\"/><circle cx=\"749\" cy=\"510\" r=\"5.7\"/><circle cx=\"768\" cy=\"510\" r=\"5.7\"/><circle cx=\"787\" cy=\"510\" r=\"5.7\"/></g><g class=\"nb-f\" data-nb=\"lashR\"><rect x=\"-3.8\" y=\"-14\" width=\"7.6\" height=\"28\" rx=\"3.8\" transform=\"translate(797 461) rotate(62)\"/><rect x=\"-3.8\" y=\"-14\" width=\"7.6\" height=\"28\" rx=\"3.8\" transform=\"translate(789 450) rotate(38)\"/><rect x=\"-3.8\" y=\"-14\" width=\"7.6\" height=\"28\" rx=\"3.8\" transform=\"translate(778 444) rotate(14)\"/></g></g></g><g class=\"nb-f\" data-nb=\"cheekR\" opacity=\".45\"><circle cx=\"794\" cy=\"534\" r=\"4.2\"/><circle cx=\"783\" cy=\"534\" r=\"4.2\"/><circle cx=\"772\" cy=\"534\" r=\"4.2\"/><circle cx=\"788.5\" cy=\"544\" r=\"4.2\"/><circle cx=\"777.5\" cy=\"544\" r=\"4.2\"/></g></g><g class=\"nb-f\" data-nb=\"lips\"><path class=\"nb-labio\" d=\"M588 556C600 545 614 546 626 553C638 546 652 545 664 556C652 570 640 576 626 576C612 576 600 570 588 556Z\" fill=\"url(#§led)\"/><path d=\"M592 557C606 562 646 562 660 557\" fill=\"none\" stroke=\"#000\" stroke-opacity=\".45\" stroke-width=\"3\"/></g></g>","brilho":"<g data-nb=\"hl\"><path d=\"M536 241C480 246 425 264 400 292C392 302 396 318 410 338C422 356 432 372 442 388C436 350 440 318 458 293C475 270 503 252 536 241Z\" fill=\"url(#§hl1)\"/><path d=\"M708 198C728 190 765 194 795 212C834 238 854 280 854 332C854 382 834 420 800 446C812 402 812 356 796 314C780 270 748 232 708 198Z\" fill=\"url(#§hl2)\"/></g>","tiara":"<g class=\"nb-f nb-tiara\"><path d=\"M489.8 193.11Q471.43 173.82 443.79 167.2Q441.53 195.54 454.2 218.97Z\" fill=\"url(#§tiara)\" stroke=\"#0a0a0a\" stroke-width=\"3\" stroke-linejoin=\"round\"/><path d=\"M570.72 160.48Q553.69 122.06 521.55 96.54Q510.55 136.08 519.36 177.17Z\" fill=\"url(#§tiara)\" stroke=\"#0a0a0a\" stroke-width=\"3\" stroke-linejoin=\"round\"/><path d=\"M659 156Q653.72 97.7 626 50Q598.28 97.7 593 156Z\" fill=\"url(#§tiara)\" stroke=\"#0a0a0a\" stroke-width=\"3\" stroke-linejoin=\"round\"/><path d=\"M732.64 177.17Q741.45 136.08 730.45 96.54Q698.31 122.06 681.28 160.48Z\" fill=\"url(#§tiara)\" stroke=\"#0a0a0a\" stroke-width=\"3\" stroke-linejoin=\"round\"/><path d=\"M797.8 218.97Q810.47 195.54 808.21 167.2Q780.57 173.82 762.2 193.11Z\" fill=\"url(#§tiara)\" stroke=\"#0a0a0a\" stroke-width=\"3\" stroke-linejoin=\"round\"/><path d=\"M381.53 298.76A272 272 0 0 1 870.47 298.76\" fill=\"none\" stroke=\"#0a0a0a\" stroke-width=\"40\" stroke-linecap=\"round\"/><path d=\"M381.53 298.76A272 272 0 0 1 870.47 298.76\" fill=\"none\" stroke=\"url(#§tiara)\" stroke-width=\"34\" stroke-linecap=\"round\"/><path d=\"M381.53 298.76A272 272 0 0 1 870.47 298.76\" fill=\"none\" stroke=\"url(#§led)\" stroke-width=\"10\" stroke-linecap=\"round\" class=\"nb-led nb-tiara-luz\"/><g fill=\"url(#§dot)\" class=\"nb-joias\"><circle cx=\"443.79\" cy=\"167.2\" r=\"13\"/><circle cx=\"521.55\" cy=\"96.54\" r=\"15\"/><circle cx=\"626\" cy=\"50\" r=\"19\"/><circle cx=\"730.45\" cy=\"96.54\" r=\"15\"/><circle cx=\"808.21\" cy=\"167.2\" r=\"13\"/><circle cx=\"466.12\" cy=\"197.95\" r=\"8.06\"/><circle cx=\"541.95\" cy=\"159.31\" r=\"9.3\"/><circle cx=\"626\" cy=\"146\" r=\"11.78\"/><circle cx=\"710.05\" cy=\"159.31\" r=\"9.3\"/><circle cx=\"785.88\" cy=\"197.95\" r=\"8.06\"/></g></g>","bracos":"</g></g></g><g class=\"nb-ombro\"><g transform=\"translate(476 864) rotate(4) scale(0.72) translate(-386 -778)\"><g data-nb=\"uaL\"><ellipse cx=\"410\" cy=\"792\" rx=\"36\" ry=\"68\" transform=\"rotate(16 410 792)\" fill=\"url(#§ball)\" stroke=\"#0c0c0c\" stroke-width=\"3\"/><path d=\"M402 714C380 682 340 662 300 666C250 671 205 700 178 752C160 786 150 820 152 852L200 892L296 900C330 884 362 862 386 840Z\" fill=\"url(#§upper)\"/><path d=\"M396 700C374 676 338 662 300 666C250 671 205 700 178 752C163 781 154 810 152 838\" fill=\"none\" style=\"stroke:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 16%)\" stroke-opacity=\".55\" stroke-width=\"4\" stroke-linecap=\"round\"/><g transform=\"rotate(-40 215 868)\"><g class=\"nb-type-L\"><g data-nb=\"faL\"><ellipse cx=\"218\" cy=\"866\" rx=\"72\" ry=\"33\" transform=\"rotate(-18 218 866)\" fill=\"#0d0d0d\"/><rect x=\"-14\" y=\"-6.5\" width=\"28\" height=\"13\" rx=\"6.5\" transform=\"translate(211 860) rotate(-38)\" fill=\"url(#§led)\" class=\"nb-led nb-halo\"/><path d=\"M172 870C130 885 108 925 112 965C117 1012 150 1050 200 1068C232 1060 264 1030 288 992C300 960 292 920 268 896C240 872 205 862 172 870Z\" fill=\"url(#§cuff)\" stroke=\"#0e0e0e\" stroke-width=\"3\"/><path d=\"M168 874C136 886 116 914 114 948C116 990 134 1024 160 1044C150 1000 160 950 196 912C214 894 236 884 256 884C232 868 200 864 168 874Z\" style=\"fill:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 41%)\" opacity=\".38\"/><g data-nb=\"hdL\"><ellipse cx=\"263\" cy=\"1002\" rx=\"76\" ry=\"56\" transform=\"rotate(-36 263 1002)\" fill=\"#0e0e0e\"/><rect x=\"-15\" y=\"-44\" width=\"30\" height=\"88\" rx=\"15\" transform=\"translate(366 994) rotate(-52)\" fill=\"url(#§finger)\" stroke=\"#0e0e0e\" stroke-width=\"4\"/><rect x=\"-21\" y=\"-52\" width=\"42\" height=\"104\" rx=\"21\" transform=\"translate(342 1043) rotate(-24)\" fill=\"url(#§finger)\" stroke=\"#0e0e0e\" stroke-width=\"4\"/><rect x=\"-21\" y=\"-54\" width=\"42\" height=\"108\" rx=\"21\" transform=\"translate(294 1066) rotate(-25)\" fill=\"url(#§finger)\" stroke=\"#0e0e0e\" stroke-width=\"4\"/><rect x=\"-19\" y=\"-48\" width=\"38\" height=\"96\" rx=\"19\" transform=\"translate(252 1084) rotate(-22)\" fill=\"url(#§finger)\" stroke=\"#0e0e0e\" stroke-width=\"4\"/><path d=\"M322 978C316 958 290 950 262 954C230 960 210 986 210 1014C210 1026 213 1034 218 1040Z\" fill=\"url(#§palm)\" stroke=\"#0e0e0e\" stroke-width=\"4\" stroke-linejoin=\"round\"/><path d=\"M300 962C282 956 258 958 240 970C226 980 218 996 216 1012C238 994 268 976 300 962Z\" fill=\"#fff\" opacity=\".18\"/></g></g></g></g></g><ellipse cx=\"386\" cy=\"778\" rx=\"44\" ry=\"74\" transform=\"rotate(12 386 778)\" fill=\"#0b0b0b\"/><ellipse cx=\"389\" cy=\"776\" rx=\"32\" ry=\"60\" transform=\"rotate(12 389 776)\" fill=\"url(#§cap)\"/><rect x=\"-8\" y=\"-29\" width=\"16\" height=\"58\" rx=\"8\" transform=\"translate(384 776) rotate(22)\" fill=\"url(#§led)\" class=\"nb-led nb-halo\"/></g></g><g transform=\"matrix(-1 0 0 1 1252 0)\"><g class=\"nb-ombro\"><g transform=\"translate(476 864) rotate(4) scale(0.72) translate(-386 -778)\"><g data-nb=\"uaR\"><ellipse cx=\"410\" cy=\"792\" rx=\"36\" ry=\"68\" transform=\"rotate(16 410 792)\" fill=\"url(#§ball)\" stroke=\"#0c0c0c\" stroke-width=\"3\"/><path d=\"M402 714C380 682 340 662 300 666C250 671 205 700 178 752C160 786 150 820 152 852L200 892L296 900C330 884 362 862 386 840Z\" fill=\"url(#§upper)\"/><path d=\"M396 700C374 676 338 662 300 666C250 671 205 700 178 752C163 781 154 810 152 838\" fill=\"none\" style=\"stroke:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 16%)\" stroke-opacity=\".55\" stroke-width=\"4\" stroke-linecap=\"round\"/><g transform=\"rotate(-40 215 868)\"><g class=\"nb-type-R\"><g data-nb=\"faR\"><ellipse cx=\"218\" cy=\"866\" rx=\"72\" ry=\"33\" transform=\"rotate(-18 218 866)\" fill=\"#0d0d0d\"/><rect x=\"-14\" y=\"-6.5\" width=\"28\" height=\"13\" rx=\"6.5\" transform=\"translate(211 860) rotate(-38)\" fill=\"url(#§led)\" class=\"nb-led nb-halo\"/><path d=\"M172 870C130 885 108 925 112 965C117 1012 150 1050 200 1068C232 1060 264 1030 288 992C300 960 292 920 268 896C240 872 205 862 172 870Z\" fill=\"url(#§cuff)\" stroke=\"#0e0e0e\" stroke-width=\"3\"/><path d=\"M168 874C136 886 116 914 114 948C116 990 134 1024 160 1044C150 1000 160 950 196 912C214 894 236 884 256 884C232 868 200 864 168 874Z\" style=\"fill:color-mix(in srgb,var(--nb-casca,#3a3a3a),#fff 41%)\" opacity=\".38\"/><g data-nb=\"hdR\"><ellipse cx=\"263\" cy=\"1002\" rx=\"76\" ry=\"56\" transform=\"rotate(-36 263 1002)\" fill=\"#0e0e0e\"/><rect x=\"-15\" y=\"-44\" width=\"30\" height=\"88\" rx=\"15\" transform=\"translate(366 994) rotate(-52)\" fill=\"url(#§finger)\" stroke=\"#0e0e0e\" stroke-width=\"4\"/><rect x=\"-21\" y=\"-52\" width=\"42\" height=\"104\" rx=\"21\" transform=\"translate(342 1043) rotate(-24)\" fill=\"url(#§finger)\" stroke=\"#0e0e0e\" stroke-width=\"4\"/><rect x=\"-21\" y=\"-54\" width=\"42\" height=\"108\" rx=\"21\" transform=\"translate(294 1066) rotate(-25)\" fill=\"url(#§finger)\" stroke=\"#0e0e0e\" stroke-width=\"4\"/><rect x=\"-19\" y=\"-48\" width=\"38\" height=\"96\" rx=\"19\" transform=\"translate(252 1084) rotate(-22)\" fill=\"url(#§finger)\" stroke=\"#0e0e0e\" stroke-width=\"4\"/><path d=\"M322 978C316 958 290 950 262 954C230 960 210 986 210 1014C210 1026 213 1034 218 1040Z\" fill=\"url(#§palm)\" stroke=\"#0e0e0e\" stroke-width=\"4\" stroke-linejoin=\"round\"/><path d=\"M300 962C282 956 258 958 240 970C226 980 218 996 216 1012C238 994 268 976 300 962Z\" fill=\"#fff\" opacity=\".18\"/></g></g></g></g></g><ellipse cx=\"386\" cy=\"778\" rx=\"44\" ry=\"74\" transform=\"rotate(12 386 778)\" fill=\"#0b0b0b\"/><ellipse cx=\"389\" cy=\"776\" rx=\"32\" ry=\"60\" transform=\"rotate(12 389 776)\" fill=\"url(#§cap)\"/><rect x=\"-8\" y=\"-29\" width=\"16\" height=\"58\" rx=\"8\" transform=\"translate(384 776) rotate(22)\" fill=\"url(#§led)\" class=\"nb-led nb-halo\"/></g></g></g>","fim":"</g></g></g>","defsOlhos":"<defs><linearGradient id=\"§led\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-luz,#ff9a18),#fff 22%)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-luz,#ff9a18),#000 8%)\"/></linearGradient><radialGradient id=\"§dot\" cx=\".45\" cy=\".4\" r=\".6\"><stop offset=\"0\" style=\"stop-color:color-mix(in srgb,var(--nb-luz,#ff9a18),#fff 30%)\"/><stop offset=\"0.7\" style=\"stop-color:var(--nb-luz,#ff9a18)\"/><stop offset=\"1\" style=\"stop-color:color-mix(in srgb,var(--nb-luz,#ff9a18),#000 10%)\"/></radialGradient><radialGradient id=\"§brilho-olho\" ><stop offset=\"0\" style=\"stop-color:var(--nb-luz,#ff9a18)\" stop-opacity=\"0.34\"/><stop offset=\"0.55\" style=\"stop-color:var(--nb-luz,#ff9a18)\" stop-opacity=\"0.12\"/><stop offset=\"1\" style=\"stop-color:var(--nb-luz,#ff9a18)\" stop-opacity=\"0\"/></radialGradient></defs>","fotoIni":"<g class=\"nb-mundo\" transform=\"translate(256 256) scale(.5) translate(-626 -612)\"><g class=\"nb-breath\"><g data-nb=\"body\"><g class=\"nb-droop\"><g class=\"nb-bob-head\"><g data-nb=\"head\">","fotoFim":"</g></g></g></g></g></g>"};
// Motor do avatar. Um só para a página inteira: um ouvinte de mouse, um laço de animação e
// observadores compartilhados, e cada avatar só gasta quadro quando tem algo mexendo.
// Em robo-avatar.js o gerador põe antes deste código o CSS (NB_CSS) e o molde (NB_T);
// dentro do robo-avatar.svg avulso vai só o motor, porque o desenho já está no arquivo.
(function () {
  'use strict';
  var W = window, D = document;
  if (W.nbAvatarInit) { comecar(); return; }

  var CSS = typeof NB_CSS !== 'undefined' ? NB_CSS : null;
  var T = typeof NB_T !== 'undefined' ? NB_T : null;
  var CORPOS = ['peito', 'cintura', 'capsula', 'robusto', 'esfera'];
  var SHOULDER = [386, 778], ELBOW = [215, 868], WRIST = [264, 996], NECK = [626, 740], HIP = [626, 1066];
  var EYE = { L: 503, R: 749 }, EYE_Y = 491;

  var lista = [], ativos = [], rodando = false, sujo = true, ligado = false, seq = 0;
  var mq = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)'), reduzir = !!(mq && mq.matches);
  var io = null, ro = null, mo = null;
  var fotos = {};   // mesma aparência, mesma foto (chave: o SVG serializado sem ids próprios)
  // Fotos da carga ficam numa fila e saem depois da primeira pintura: primeiro todas as leituras de estilo, depois as montagens
  var filaFoto = [];
  function fotosPendentes() {
    var f = filaFoto, urls; filaFoto = [];
    urls = f.map(function (a) { return a.svg.isConnected && a.svg.__nb === a ? a.chaveFoto() : null; });
    f.forEach(function (a, i) { if (urls[i]) a.fotoPronta(urls[i]); else if (a.svg.__nb === a) a.garantir(); });
  }

  function agora() { return W.performance ? W.performance.now() : Date.now(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function suave(a, b, v) { v = clamp((v - a) / (b - a), 0, 1); return v * v * (3 - 2 * v); }
  function f(n) { return Math.round(n * 100) / 100; }
  function tr(x, y) { return 'translate(' + f(x) + ' ' + f(y) + ')'; }
  function rot(a, p) { return 'rotate(' + f(a) + ' ' + p[0] + ' ' + p[1] + ')'; }
  function esc(sx, sy, cx, cy) { return 'translate(' + cx + ' ' + cy + ') scale(' + f(sx) + ' ' + f(sy) + ') translate(' + -cx + ' ' + -cy + ')'; }
  function put(e, a, v) { if (!e) return; v = String(v); var c = e.__nbv || (e.__nbv = {}); if (c[a] === v) return; c[a] = v; e.setAttribute(a, v); }
  function cor(c) { c = String(c || '').trim(); return /^[0-9a-f]{3,8}$/i.test(c) ? '#' + c : c; }

  function Mola(k, d) { this.k = k; this.d = d; this.x = 0; this.v = 0; this.t = 0; }
  Mola.prototype.passo = function (dt) { var a = (this.t - this.x) * this.k - this.v * this.d; this.v += a * dt; this.x += this.v * dt; };
  Mola.prototype.parada = function () { return Math.abs(this.t - this.x) < .002 && Math.abs(this.v) < .01; };

  // ---------- molde: monta só as peças deste bot ----------
  function montar(svg) {
    var fem = svg.getAttribute('data-genero') === 'f', corpo = svg.getAttribute('data-corpo');
    if (CORPOS.indexOf(corpo) < 0) corpo = 'peito';
    var P = 'nb' + (++seq) + '-';
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 512 512');
    if (!svg.getAttribute('role')) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Avatar do robô'); }
    svg.innerHTML = (T.defs + (fem ? T.defsF : '') + T.ini + (fem ? T.vestido : T.corpo[corpo]) + T.cabeca +
      (fem ? T.olhosF : T.olhosM) + T.brilho + (fem ? T.tiara : '') + T.bracos + T.fim).split('§').join(P);
    svg.__nbMolde = corpo + (fem ? 'f' : 'm');
  }

  // ---------- um avatar ----------
  function criar(svg) {
    var a = { svg: svg, rect: null, visivel: true, mini: false, last: 0, foto: false };
    var fotoTimer = 0, dentroDoQuadro = false;
    svg.__nb = a;
    svg.classList.add('nb-js');
    var largura = svg.width && svg.width.baseVal && svg.width.baseVal.unitType === 1 ? svg.width.baseVal.value : 0;
    var nasceFoto = T && !svg.firstElementChild && largura > 0 && largura < 96 && svg.getAttribute('data-ativo') !== 'sim';
    if (T && !svg.firstElementChild && !nasceFoto) montar(svg);
    if (nasceFoto) { a.mini = true; svg.classList.add('nb-mini'); }
    var el, dots, S, blinkAt, blinkLen = 150, dupla = false, onda = -1e9, lado = 1;
    var aim = { x: 0, y: .06 }, emCima = false, naCara = false, forcado = false, graca = 0, estavaAcordado = false;
    var lastHp = -1, lastSp = -1, timer = 0;

    function q(n) { return svg.querySelector('[data-nb="' + n + '"]'); }
    // olhos: normal (4/5/5), feliz (^) e dormindo; pontos casados pela ordem horizontal
    function pontos(s) {
      var c = EYE[s], i, fz = [], so = [], g = el['eye' + s];
      if (!g) return [];
      for (i = 0; i < 7; i++) fz.push([c - 47.5 + 47.5 * i / 6, 503 - 38 * i / 6]);
      for (i = 0; i < 7; i++) fz.push([c + 47.5 * i / 6, 465 + 38 * i / 6]);
      for (i = 0; i < 14; i++) { var u = -1 + 2 * i / 13; so.push([c + 47.5 * u, 488 + 14 * (1 - u * u)]); }
      var b = [].slice.call(g.querySelectorAll('circle')).map(function (d) { return { el: d, x: +d.getAttribute('cx'), y: +d.getAttribute('cy') }; });
      b.slice().sort(function (p, p2) { return p.x - p2.x || p.y - p2.y; }).forEach(function (d, k) { d.hx = fz[k][0]; d.hy = fz[k][1]; d.sx = so[k][0]; d.sy = so[k][1]; });
      return b;
    }
    function referencias() {
      el = {};
      ['body', 'head', 'visor', 'ears', 'bandL', 'bandR', 'eyes', 'hl', 'neck', 'sideL', 'sideR', 'lidsL', 'lidsR', 'eyeL', 'eyeR',
        'browL', 'browR', 'lashL', 'lashR', 'cheekL', 'cheekR', 'lips', 'uaL', 'faL', 'hdL', 'uaR', 'faR', 'hdR'].forEach(function (n) { el[n] = q(n); });
      dots = { L: pontos('L'), R: pontos('R') };
      lastHp = lastSp = -1;
    }
    if (!nasceFoto) referencias(); else el = {}, dots = { L: [], R: [] };

    // ---------- modo foto: calmo na lista, o corpo vira uma imagem desenhada uma vez e só os olhos ficam vivos ----------
    // A imagem é montada direto do molde (sem passar pelo robô completo), na pose calma do tamanho pequeno.
    var CORPO_CALMA = 'translate(0 18) translate(0 0.18) rotate(0 626 1066)';
    var MAO_ALTA = ['rotate(24 386 778)', 'rotate(-150 215 868)'];   // alerta: mão levantada ao lado da cabeça
    var CABECA_CALMA = 'translate(0 0.72) rotate(0 626 740) translate(626 740) scale(1.06 1.06) translate(-626 -740)';
    function urlFoto() {
      var fem = svg.getAttribute('data-genero') === 'f', corpo = svg.getAttribute('data-corpo');
      if (CORPOS.indexOf(corpo) < 0) corpo = 'peito';
      var cs = W.getComputedStyle(svg), vars = '';
      ['--nb-casca', '--nb-luz', '--nb-roupa'].forEach(function (k) { var v = cs.getPropertyValue(k).trim(); if (v) vars += k + ':' + v + ';'; });
      var est = svg.getAttribute('data-estado') || 'online';
      var bracos = est === 'alerta' ? T.bracos.replace('data-nb="uaR"', 'data-nb="uaR" transform="' + MAO_ALTA[0] + '"').replace('data-nb="faR"', 'data-nb="faR" transform="' + MAO_ALTA[1] + '"') : T.bracos;
      var txt = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" class="nb-avatar nb-js nb-mini nb-foto" data-genero="' + (fem ? 'f' : 'm') +
        '" data-corpo="' + corpo + '" data-estado="' + est + '" style="' + vars + '"><style>' + (CSS || '') + '</style>' +
        (T.defs + (fem ? T.defsF : '') + T.ini.replace('data-nb="body"', 'data-nb="body" transform="' + CORPO_CALMA + '"') +
        (fem ? T.vestido : T.corpo[corpo]) + T.cabeca.replace('data-nb="head"', 'data-nb="head" transform="' + CABECA_CALMA + '"') +
        T.brilho + (fem ? T.tiara : '') + bracos + T.fim).split('§').join('f-') + '</svg>';
      if (!fotos[txt]) fotos[txt] = URL.createObjectURL(new Blob([txt], { type: 'image/svg+xml' }));
      return fotos[txt];
    }
    function montarFoto(url) {
      var fem = svg.getAttribute('data-genero') === 'f', P = 'nb' + (++seq) + '-';
      if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 512 512');
      if (!svg.getAttribute('role')) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Avatar do robô'); }
      svg.innerHTML = (T.defsOlhos + '<image href="' + url + '" width="512" height="512"/>' + T.fotoIni.replace('data-nb="body"', 'data-nb="body" transform="' + CORPO_CALMA + '"')
        .replace('data-nb="head"', 'data-nb="head" transform="' + CABECA_CALMA + '"') + (fem ? T.olhosF : T.olhosM) + T.fotoFim).split('§').join(P);
      svg.__nbMolde = 'foto';
      a.foto = true;
      referencias();
      posar();   // olhos, sobrancelhas e cílios já no estado atual (dormindo, feliz) antes de pintar
    }
    // aplica a pose atual na hora, sem esperar o laço (que na lista pula quadros por até 40 ms)
    function posar() {
      if (!a.quadro || dentroDoQuadro) return;
      if (timer) { clearTimeout(timer); timer = 0; }
      a.last = agora();
      if (a.quadro(a.last)) a.acordar();
    }
    function irParaFoto(jaVisivel) {
      fotoTimer = 0;
      if (a.foto || !a.mini || !T || !svg.isConnected || acordado(agora())) return;
      var url = urlFoto();
      if (!jaVisivel) { montarFoto(url); return; }
      var img = new Image();   // já está na tela: carrega antes de trocar, para não piscar
      img.onload = function () { if (!a.foto && a.mini && !acordado(agora()) && svg.isConnected) montarFoto(url); };
      img.src = url;
    }
    function irParaVivo() {
      if (fotoTimer) { clearTimeout(fotoTimer); fotoTimer = 0; }
      if (!a.foto) return;
      a.foto = false;
      montar(svg); referencias(); sujo = true;
      posar();
    }
    a.vivo = irParaVivo;
    a.chaveFoto = urlFoto;
    a.fotoPronta = function (url) {   // a imagem carrega antes de entrarem os olhos: nunca aparecem olhos sem corpo
      var img = new Image();
      img.onload = img.onerror = function (e) {
        if (svg.__nb !== a || a.foto || svg.firstElementChild) return;
        if (e.type === 'load' && a.mini && svg.isConnected && !acordado(agora())) montarFoto(url); else { a.garantir(); a.acordar(); }
      };
      img.src = url;
    };
    a.garantir = function () { if (T && !svg.firstElementChild) { montar(svg); referencias(); posar(); } };   // nunca fica vazio
    if (nasceFoto) { if (!filaFoto.length) W.requestAnimationFrame(function () { setTimeout(fotosPendentes, 0); }); filaFoto.push(a); }
    else a.garantir();

    S = {
      lx: new Mola(70, 12), ly: new Mola(70, 12),
      aL: new Mola(55, 9), fL: new Mola(46, 8.5), hL: new Mola(32, 7.5),
      aR: new Mola(55, 9), fR: new Mola(46, 8.5), hR: new Mola(32, 7.5),
      happy: new Mola(90, 15), sleep: new Mola(36, 11), hop: new Mola(140, 12), alerta: new Mola(40, 10)
    };
    blinkAt = agora() + 900 + Math.random() * 2600;

    function estado() { return svg.getAttribute('data-estado') || 'online'; }
    function desligado() { return svg.getAttribute('data-estado') === 'offline'; }
    function acordado(t) { return !desligado() && (forcado || svg.getAttribute('data-ativo') === 'sim' || emCima || t < graca); }
    function t0Acordado() { return !desligado() && (svg.getAttribute('data-ativo') === 'sim' || agora() < graca); }
    function rostoY() { return svg.getAttribute('data-genero') === 'f' ? 207 : 177; }

    // já nasce no estado certo (não fecha os olhos na frente de quem abre a lista)
    (function () {
      var e0 = estado(), t0 = agora();
      S.sleep.x = S.sleep.t = (e0 === 'ausente' && !acordado(t0)) ? 1 : 0;
      S.happy.x = S.happy.t = e0 === 'trabalhando' ? 1 : 0;
      S.alerta.x = S.alerta.t = e0 === 'alerta' ? 1 : 0;
      estavaAcordado = acordado(t0); svg.classList.toggle('nb-acordado', estavaAcordado);
    })();

    function proxima(t) {
      if (dupla) { dupla = false; blinkAt = t + 90; return; }
      blinkAt = t + (estado() === 'trabalhando' ? 1300 + Math.random() * 1800 : 2400 + Math.random() * 3800);
      dupla = Math.random() < .22;
    }
    function piscada(t) {
      var p = (t - blinkAt) / blinkLen;
      if (p >= 1) { proxima(t); return 0; }
      return p < 0 ? 0 : Math.sin(p * Math.PI);
    }

    a.acordar = function () {
      if (timer) { clearTimeout(timer); timer = 0; }
      if (!a.visivel || !svg.isConnected) return;
      if (ativos.indexOf(a) < 0) { a.last = agora(); ativos.push(a); }
      if (!rodando) { rodando = true; W.requestAnimationFrame(laco); }
    };
    a.mira = function (x, y) {
      var r = a.rect;
      if (!r || !r.width) return;
      // longe e dormindo: nada a calcular
      var pad0 = r.width * .04;
      if (!emCima && !forcado && t0Acordado() === false && (x < r.left - pad0 || x > r.right + pad0 || y < r.top - pad0 || y > r.bottom + pad0)) return;
      var fy = rostoY(), hx = r.left + r.width * .5, hy = r.top + r.height * fy / 512;
      var reach = Math.max(r.width * .9, Math.min(W.innerWidth || r.width, W.innerHeight || r.height) * .42);
      var nx = (x - hx) / reach, ny = (y - hy) / reach, m = Math.sqrt(nx * nx + ny * ny);
      if (m > 1e-4) { var k = Math.tanh(m * 1.25) / m; nx *= k; ny *= k; }
      aim.x = nx; aim.y = ny;
      var pad = r.width * .04;
      var dentro = x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
      var ux = (x - r.left) / r.width * 512 - 256, uy = (y - r.top) / r.height * 512 - fy;
      naCara = dentro && ux * ux + uy * uy < 130 * 130;
      if (emCima && !dentro) graca = agora() + 700;
      var mudou = emCima !== dentro;
      emCima = dentro;
      if (mudou || acordado(agora())) a.acordar();
    };
    a.clique = function (x, y, toque) {
      a.mira(x, y);
      if (emCima && agora() - onda > 900) { onda = agora(); lado = x < a.rect.left + a.rect.width / 2 ? -1 : 1; a.acordar(); }
      if (toque) a.soltar(2200);
    };
    a.soltar = function (ms) { if (emCima || naCara) { emCima = naCara = false; graca = Math.max(graca, agora() + ms); a.acordar(); } };
    a.tamanho = function (w) {
      if (!(w > 0)) return;   // escondido (display:none, aba fechada) ou fora da página: mantém o modo
      var m = w < 96;
      if (m !== a.mini) { a.mini = m; svg.classList.toggle('nb-mini', m); lastHp = -1; if (!m) irParaVivo(); a.acordar(); }
    };
    var estiloVisto = svg.getAttribute('style') || '';
    a.atributo = function (nome) {
      if (nome === 'style') { var st = svg.getAttribute('style') || ''; if (st === estiloVisto) return; estiloVisto = st; }
      if (a.foto && nome !== 'data-cor' && nome !== 'data-ativo') irParaVivo();
      if ((nome === 'data-corpo' || nome === 'data-genero') && svg.__nbMolde && T) {
        var fem = svg.getAttribute('data-genero') === 'f', c = svg.getAttribute('data-corpo');
        if (svg.__nbMolde !== (CORPOS.indexOf(c) < 0 ? 'peito' : c) + (fem ? 'f' : 'm')) { montar(svg); referencias(); sujo = true; posar(); }
      }
      a.acordar();
    };
    a.destruir = function () {
      if (timer) clearTimeout(timer);
      if (fotoTimer) clearTimeout(fotoTimer);
      var i = lista.indexOf(a); if (i >= 0) lista.splice(i, 1);
      i = ativos.indexOf(a); if (i >= 0) ativos.splice(i, 1);
      if (io) io.unobserve(svg);
      if (ro) ro.unobserve(svg);
      svg.__nb = null; svg.__nbAvatar = false;
    };

    // um quadro; devolve true enquanto precisa de mais quadros
    function quadro0(t) {
      var dt = Math.min((t - a.last) / 1000, 1 / 20); a.last = t;
      var est = estado(), on = acordado(t);
      if (a.foto && (on || t - onda < 2000 || !a.mini)) irParaVivo();
      if (on !== estavaAcordado) { svg.classList.toggle('nb-acordado', on); if (on && !reduzir) S.hop.v = -200; estavaAcordado = on; }

      // aceno: o braço do lado do clique sobe e a mão balança ao lado da cabeça
      var wp = (t - onda) / 2000, env = 0, osc = 0;
      if (wp >= 0 && wp < 1 && !reduzir) { env = suave(0, .16, wp) * (1 - suave(.72, 1, wp)); osc = Math.sin((wp - .12) * Math.PI * 6.8) * suave(.1, .25, wp); }
      var segue = on && !reduzir, tx = segue ? aim.x : 0, ty = segue ? aim.y : .06;
      S.lx.t = tx; S.ly.t = ty;
      S.happy.t = (est === 'trabalhando' || env > .05 || (on && naCara)) ? 1 : 0;
      S.sleep.t = (est === 'ausente' && !on) ? 1 : 0;
      var aL = segue ? clamp(-tx * 26 - ty * 12, -16, 30) : 0, aR = segue ? clamp(tx * 26 - ty * 12, -16, 30) : 0;
      var wL = lado < 0 ? env : 0, wR = lado > 0 ? env : 0, oL = lado < 0 ? osc : 0, oR = lado > 0 ? osc : 0;
      S.aL.t = aL * (1 - wL) + wL * 24; S.aR.t = aR * (1 - wR) + wR * 24;
      S.fL.t = (-aL * .42 - tx * 8 - S.aL.v * .05) * (1 - wL) + wL * (-150 + oL * 22);
      S.fR.t = (-aR * .42 + tx * 8 - S.aR.v * .05) * (1 - wR) + wR * (-150 + oR * 22);
      S.hL.t = (-S.fL.x * .3 - tx * 6 - S.fL.v * .04) * (1 - wL) + wL * oL * 16;
      S.hR.t = (-S.fR.x * .3 + tx * 6 - S.fR.v * .04) * (1 - wR) + wR * oR * 16;
      S.alerta.t = est === 'alerta' ? 1 : 0;
      var al = clamp(S.alerta.x, 0, 1), bal = (est === 'alerta' && !a.mini && !reduzir) ? Math.sin(t / 1000 * 2.4) : 0;
      if (al > .001 && wR < .01) {
        S.aR.t = S.aR.t * (1 - al) + al * 24; S.fR.t = S.fR.t * (1 - al) + al * (-150 + bal * 7); S.hR.t = S.hR.t * (1 - al) + al * bal * 6;
      }
      var n = Math.max(1, Math.ceil(dt * 120)), h = dt / n, k, i;
      for (i = 0; i < n; i++) for (k in S) S[k].passo(h);
      if (reduzir) for (k in S) { S[k].x = S[k].t; S[k].v = 0; }   // movimento reduzido: nada anima, só vai ao destino

      var lx = S.lx.x, ly = S.ly.x, hp = clamp(S.happy.x, 0, 1), sp = clamp(S.sleep.x, 0, 1);
      var vivo = est === 'trabalhando' || (est === 'alerta' && !a.mini);
      var pode = sp < .3 && est !== 'offline' && vivo;
      var piscando = pode && t >= blinkAt && t < blinkAt + blinkLen;
      var bl = pode ? piscada(t) * (est === 'trabalhando' ? 1 : 1 - hp) : 0;
      if (a.mini && piscando) bl = est === 'trabalhando' || hp < .5 ? 1 : 0;   // na lista: fecha e abre, dois desenhos só
      if (!pode && t > blinkAt) proxima(t);
      var mini = a.mini, ex = mini ? .72 : 1;

      // corpo inclina pouco; a cabeça vira: o rosto anda mais que o vidro, a faixa de vidro do lado
      // para onde ele olha afina, reflexos e orelhas vão ao contrário
      put(el.body, 'transform', (mini ? 'translate(0 18) ' : '') + tr(lx * 8, ly * 3 + S.hop.x) + ' ' + rot(lx * 2.5, HIP));
      put(el.head, 'transform', tr(lx * 20, ly * 12) + ' ' + rot(lx * 7, NECK) + (mini ? ' ' + esc(1.06, 1.06, NECK[0], NECK[1]) : ''));
      put(el.visor, 'transform', tr(lx * 34 * ex, ly * 24 * ex));
      put(el.ears, 'transform', tr(-lx * 14, -ly * 6));
      put(el.bandL, 'transform', esc(1 + lx * .4, 1, 366, 0));
      put(el.bandR, 'transform', esc(1 - lx * .4, 1, 366, 0));
      put(el.hl, 'transform', tr(-lx * 10, -ly * 8));
      put(el.eyes, 'transform', tr(0, ly * 42 * ex));
      put(el.sideL, 'transform', tr(lx * (lx < 0 ? 50 : 66) * ex, 0));
      put(el.sideR, 'transform', tr(lx * (lx > 0 ? 50 : 66) * ex, 0));
      put(el.lips, 'transform', tr(lx * 58 * ex, -hp * 3));
      put(el.neck, 'transform', tr(lx * 5, 0));

      // olhos: o do lado para onde ele olha encolhe (perspectiva), piscada, feliz e dormindo
      var sy = 1 - bl * .88;
      put(el.lidsL, 'transform', esc(1 - Math.max(0, -lx) * .28, sy, EYE.L, EYE_Y));
      put(el.lidsR, 'transform', esc(1 - Math.max(0, lx) * .28, sy, EYE.R, EYE_Y));
      var by = (mini ? -20 : 0) - hp * 9 + sp * (mini ? -6 : 6) + bl * 4, ly2 = hp * (mini ? 16 : 34) + sp * 26;
      put(el.browL, 'transform', tr(0, by)); put(el.browR, 'transform', tr(0, by));
      put(el.lashL, 'transform', tr(-hp * 4 - sp * 4, ly2)); put(el.lashR, 'transform', tr(hp * 4 + sp * 4, ly2));
      if (Math.abs(hp - lastHp) > .001 || Math.abs(sp - lastSp) > .001) {
        lastHp = hp; lastSp = sp;
        var tot = hp + sp, wh = tot > 1 ? hp / tot : hp, ws = tot > 1 ? sp / tot : sp;
        put(el.eyes, 'opacity', f(1 - sp * .45));
        put(el.cheekL, 'opacity', f(.45 + hp * .45 - sp * .2)); put(el.cheekR, 'opacity', f(.45 + hp * .45 - sp * .2));
        put(el.browL, 'opacity', f(1 - sp * (mini ? .8 : .5))); put(el.browR, 'opacity', f(1 - sp * (mini ? .8 : .5)));
        for (var s in dots) for (i = 0; i < dots[s].length; i++) {
          var d = dots[s][i];
          put(d.el, 'cx', f(d.x + (d.hx - d.x) * wh + (d.sx - d.x) * ws));
          put(d.el, 'cy', f(d.y + (d.hy - d.y) * wh + (d.sy - d.y) * ws));
        }
      }

      // braços
      put(el.uaL, 'transform', rot(S.aL.x, SHOULDER)); put(el.uaR, 'transform', rot(S.aR.x, SHOULDER));
      put(el.faL, 'transform', rot(S.fL.x, ELBOW)); put(el.faR, 'transform', rot(S.fR.x, ELBOW));
      put(el.hdL, 'transform', rot(S.hL.x, WRIST)); put(el.hdR, 'transform', rot(S.hR.x, WRIST));

      // parado: desliga até a próxima piscada (ou até o mouse mexer)
      var quieto = env === 0 && (!piscando || a.mini) && !bal;
      for (k in S) if (!S[k].parada()) { quieto = false; break; }
      if (quieto) {
        var espera = pode ? (piscando ? blinkAt + blinkLen - t + 1 : blinkAt - t) : 1e9;
        if (graca > t) espera = Math.min(espera, graca - t + 20);
        if (espera < 1e9) timer = setTimeout(a.acordar, Math.max(16, espera));
        if (!a.foto && !fotoTimer && a.mini && !on && T) fotoTimer = setTimeout(function () { irParaFoto(a.visivel); }, 1200);
        return false;
      }
      return true;
    }
    a.quadro = function (t) { dentroDoQuadro = true; try { return quadro0(t); } finally { dentroDoQuadro = false; } };

    svg.nbAvatar = {
      set: function (o) {
        o = o || {};
        if (o.corpo && CORPOS.indexOf(o.corpo) >= 0) svg.setAttribute('data-corpo', o.corpo);
        if (o.genero) svg.setAttribute('data-genero', /^f/i.test(o.genero) ? 'f' : 'm');
        if (o.estado) svg.setAttribute('data-estado', o.estado);
        if (o.ativo !== undefined && o.ativo !== null) svg.setAttribute('data-ativo', o.ativo === true || o.ativo === 'sim' ? 'sim' : 'nao');
        var antes = svg.getAttribute('style') || '';
        if (o.luz) svg.style.setProperty('--nb-luz', cor(o.luz));
        if (o.casca) svg.style.setProperty('--nb-casca', cor(o.casca));
        if (o.roupa !== undefined && o.roupa !== null) { if (o.roupa === '') svg.style.removeProperty('--nb-roupa'); else svg.style.setProperty('--nb-roupa', cor(o.roupa)); }
        if ((svg.getAttribute('style') || '') !== antes) irParaVivo();   // cor mudou: a foto precisa ser refeita
        a.atributo('data-cor');
      },
      acordar: function (v) { forcado = v !== false; if (!forcado) graca = agora() + 500; a.acordar(); },
      acenar: function (l) { onda = agora(); lado = l === 'esquerda' ? -1 : 1; a.acordar(); }
    };
    posar();   // já nasce posado: o primeiro quadro pintado tem os olhos certos
    return a;
  }

  // ---------- laço e eventos compartilhados ----------
  function laco() {
    if (W.document.hidden) { rodando = false; return; }   // aba oculta: o laço dorme, volta no visibilitychange
    var t = agora(), seguem = [];
    for (var i = 0; i < ativos.length; i++) {
      var a = ativos[i];
      if (!a.svg.isConnected) { a.destruir(); continue; }
      if (!a.visivel) continue;
      if (t - a.last < 30) { seguem.push(a); continue; }   // no máximo 30 quadros por segundo
      if (a.quadro(t)) seguem.push(a);
    }
    ativos = seguem;
    if (ativos.length) W.requestAnimationFrame(laco); else rodando = false;
  }
  function medir() {
    for (var i = lista.length - 1; i >= 0; i--) {
      if (!lista[i].svg.isConnected) { lista[i].destruir(); continue; }
      if (lista[i].visivel) lista[i].rect = lista[i].svg.getBoundingClientRect();
    }
    sujo = false; medidoEm = agora();
  }
  var ultimo = null, medidoEm = 0;
  // a página muda de lugar sem scroll nem resize (aviso no topo, seção abrindo, fonte carregando): remede no máximo a cada 300 ms
  function mover(e) { ultimo = [e.clientX, e.clientY]; if (sujo || agora() - medidoEm > 300) medir(); for (var i = 0; i < lista.length; i++) lista[i].mira(e.clientX, e.clientY); }
  function ligar() {
    if (ligado) return; ligado = true;
    var p = { passive: true };
    W.addEventListener('pointermove', mover, p);
    var toque = false;
    W.addEventListener('pointerdown', function (e) { toque = e.pointerType !== 'mouse'; }, p);
    W.addEventListener('click', function (e) {
      if (!e.detail) return;   // clique de teclado não acena
      medir();   // clique é raro: sempre com a posição de agora
      for (var i = 0; i < lista.length; i++) lista[i].clique(e.clientX, e.clientY, toque);
    }, p);
    W.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') for (var i = 0; i < lista.length; i++) lista[i].soltar(700); }, p);
    W.addEventListener('pointercancel', function (e) { if (e.pointerType !== 'mouse') for (var i = 0; i < lista.length; i++) lista[i].soltar(0); }, p);
    W.addEventListener('scroll', function () {
      sujo = true;   // sem medir no scroll: a posição só é lida quando o mouse mexe ou há clique
    }, { passive: true, capture: true });
    W.document.addEventListener('visibilitychange', function () {
      if (!W.document.hidden) { sujo = true; for (var i = 0; i < lista.length; i++) lista[i].acordar(); }
    });
    W.addEventListener('resize', function () { sujo = true; });
    W.addEventListener('mouseout', function (e) { if (!e.relatedTarget) for (var i = 0; i < lista.length; i++) lista[i].soltar(700); });
    if (mq && mq.addEventListener) mq.addEventListener('change', function (e) { reduzir = e.matches; for (var i = 0; i < lista.length; i++) lista[i].acordar(); });
    if ('IntersectionObserver' in W) io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var a = e.target.__nb; if (!a) return;
        if (!e.target.isConnected) { a.destruir(); return; }
        a.visivel = e.isIntersecting; e.target.classList.toggle('nb-fora', !a.visivel);
        if (a.visivel) { sujo = true; a.acordar(); }
      });
    });
    if ('ResizeObserver' in W) ro = new ResizeObserver(function (es) {
      es.forEach(function (e) { var a = e.target.__nb; if (a) a.tamanho(e.contentRect.width); });
      sujo = true;
    });
    if ('MutationObserver' in W) mo = new MutationObserver(function (ms) {
      ms.forEach(function (m) { var a = m.target.__nb; if (a) a.atributo(m.attributeName); });
    });
  }

  // SVG completo colado na página: ids próprios, para não usar os gradientes de outro avatar
  function renomear(svg) {
    var nos = svg.querySelectorAll('[id]'), i, mapa = {}, P = 'nb' + (++seq) + '-';
    if (!nos.length) return;
    for (i = 0; i < nos.length; i++) { mapa[nos[i].id] = P + nos[i].id; nos[i].id = P + nos[i].id; }
    var todos = svg.querySelectorAll('[fill],[stroke],[filter],[clip-path],[href]'), at = ['fill', 'stroke', 'filter', 'clip-path', 'href'];
    for (i = 0; i < todos.length; i++) for (var j = 0; j < at.length; j++) {
      var v = todos[i].getAttribute(at[j]); if (!v) continue;
      var nv = v.replace(/url\(#([^)]+)\)/g, function (m, id) { return mapa[id] ? 'url(#' + mapa[id] + ')' : m; });
      if (nv.charAt(0) === '#' && mapa[nv.slice(1)]) nv = '#' + mapa[nv.slice(1)];
      if (nv !== v) todos[i].setAttribute(at[j], nv);
    }
  }

  function iniciar(svg) {
    if (!svg || svg.__nbAvatar) return;
    if (T && (svg.__nbMolde || svg.querySelector('image'))) { svg.textContent = ''; svg.__nbMolde = null; }   // cloneNode ou reinserção: refaz do molde
    if (!svg.firstElementChild && !T) return;   // vazio e sem molde: nada a fazer
    svg.__nbAvatar = true;
    ligar();
    if (CSS && !D.getElementById('nb-avatar-css')) {
      var st = D.createElement('style'); st.id = 'nb-avatar-css'; st.textContent = CSS; (D.head || D.documentElement).appendChild(st);
    }
    // SVG completo colado na página: as regras dele vão uma vez só para o <head>
    if (svg !== D.documentElement && svg.firstElementChild) {
      var est = svg.querySelector('style');
      if (est) {
        if (!D.getElementById('nb-avatar-css')) { var ns = D.createElement('style'); ns.id = 'nb-avatar-css'; ns.textContent = est.textContent; (D.head || D.documentElement).appendChild(ns); }
        est.parentNode.removeChild(est);
      }
      renomear(svg);
    }
    var a = criar(svg);
    lista.push(a); sujo = true;
    if (io) io.observe(svg);
    if (ro) ro.observe(svg); else a.tamanho(svg.getBoundingClientRect().width);
    if (mo) mo.observe(svg, { attributes: true, attributeFilter: ['data-corpo', 'data-estado', 'data-ativo', 'data-genero', 'style'] });
    if (svg === D.documentElement) {
      try {
        var qs = new URLSearchParams(W.location.search), o = {};
        ['corpo', 'genero', 'estado', 'ativo', 'luz', 'casca', 'roupa'].forEach(function (k) { if (qs.get(k)) o[k] = qs.get(k); });
        svg.nbAvatar.set(o);
      } catch (err) { /* sem parâmetros */ }
    }
    a.acordar();
  }
  W.nbAvatarInit = iniciar;

  function varrer(n) {
    if (n.nodeType !== 1) return;
    if (n.classList && n.classList.contains('nb-avatar') && n.namespaceURI === 'http://www.w3.org/2000/svg') iniciar(n);
    var c = n.getElementsByClassName ? n.getElementsByClassName('nb-avatar') : [];
    for (var i = 0; i < c.length; i++) iniciar(c[i]);
  }
  function comecar() {
    var me = D.currentScript, dono = me && me.closest && me.closest('svg');
    if (dono) { W.nbAvatarInit(dono); return; }
    if (D.documentElement.namespaceURI === 'http://www.w3.org/2000/svg') { W.nbAvatarInit(D.documentElement); return; }
    if (W.__nbVarrendo) return;
    W.__nbVarrendo = true;
    var vai = function () {
      varrer(D.documentElement);
      new MutationObserver(function (ms) {
        var saiu = false;
        for (var i = 0; i < ms.length; i++) {
          if (ms[i].target.__nb) continue;   // troca interna de um avatar (foto <-> vivo)
          for (var j = 0; j < ms[i].addedNodes.length; j++) varrer(ms[i].addedNodes[j]);
          if (ms[i].removedNodes.length) saiu = true;
        }
        if (saiu) for (var k = lista.length - 1; k >= 0; k--) if (!lista[k].svg.isConnected) lista[k].destruir();
      }).observe(D.documentElement, { childList: true, subtree: true });
    };
    vai();   // liga o que já existe e observa o que vier depois (vale também com o script no <head>)
  }
  comecar();
})();
})();
