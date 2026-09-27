import '../src/style.css'
import '../src/theme/synthwave.css'

// Toolbar switch between the shipped look and the synthwave concept.
const withTheme=(story,ctx)=>{
  const theme=ctx.globals.theme||'synthwave'
  if(theme==='synthwave')document.documentElement.dataset.theme='synthwave'
  else delete document.documentElement.dataset.theme
  return story()
}

export default {
  decorators:[withTheme],
  globalTypes:{
    theme:{description:'Visual theme',toolbar:{title:'Theme',icon:'paintbrush',items:[{value:'synthwave',title:'Synthwave (concept)'},{value:'current',title:'Current'}],dynamicTitle:true}},
  },
  initialGlobals: { theme: 'synthwave', viewport: { value: 'mobile2', isRotated: false } },
  parameters: {
    layout: 'fullscreen',
    backgrounds: { disable: true },
    options: { storySort: { order: ['Overview', 'Design', 'Landing', 'Director', 'Judge', 'Competitor', 'Live Display', 'Feedback'] } },
  },
}
