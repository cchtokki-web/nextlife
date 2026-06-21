import { UserProfile } from '../../../core/entities/types';

export function generateRuleBasedAdvice(
  score: number,
  monthlyTarget: number,
  isPro: boolean,
  userProfile?: UserProfile
): string {
  // 기본값이 없을 때를 대비한 기본 프로필 설정
  const currentAge = userProfile?.currentAge || 40;
  const retirementAge = userProfile?.retirementAge || 60;
  
  const targetInManwon = Math.round(monthlyTarget / 10000);
  const yearsToRetire = Math.max(0, retirementAge - currentAge);

  let intro = '';
  let analysis = '';
  let strategy = '';
  const outro = '\n\n자세한 사항은 전문 공인 재무 설계사나 투자 자문 전문가와의 상담을 권장합니다.';

  // 1. 점수 구간에 따른 분석 (5가지)
  if (score >= 95) {
    analysis = `시뮬레이션 결과 ${score}점으로 은퇴 후 생활이 매우 안정적인 훌륭한 상태입니다. `;
  } else if (score >= 85) {
    analysis = `시뮬레이션 결과 ${score}점으로 목표하신 은퇴 생활을 무리 없이 유지할 수 있는 안정적인 상태입니다. `;
  } else if (score >= 70) {
    analysis = `시뮬레이션 결과 ${score}점으로 목표 생활비 달성이 대체로 가능하지만, 약간의 변동성에 대비할 필요가 있는 보통 수준입니다. `;
  } else if (score >= 50) {
    analysis = `시뮬레이션 결과 ${score}점으로 목표하신 생활비를 감당하기에는 자산 고갈 위험이 있는 주의가 필요한 상태입니다. `;
  } else {
    analysis = `시뮬레이션 결과 ${score}점으로 현재 계획대로라면 은퇴 후 자산이 빠르게 고갈될 수 있는 위험 상태입니다. `;
  }

  // 2. 현재 연령대에 따른 인사이트 (4가지)
  if (currentAge < 35) {
    analysis += `아직 2030 세대인 만큼 장기 투자의 복리 효과를 최대한 누릴 수 있는 아주 유리한 시기예요. `;
  } else if (currentAge >= 35 && currentAge < 45) {
    analysis += `자산 형성의 핵심 시기인 3040 세대이시군요. 소득이 가장 활발한 이 시기에 체계적인 포트폴리오를 다져두는 것이 중요해요. `;
  } else if (currentAge >= 45 && currentAge < 55) {
    analysis += `은퇴가 서서히 가시권에 들어오는 4050 세대로서, 이제는 자산의 증식만큼이나 방어와 연금 비중 확대가 중요해지는 시점입니다. `;
  } else {
    analysis += `은퇴를 앞두고 계신 만큼, 공격적인 투자보다는 안정적인 현금흐름 창출(배당, 연금) 위주로 포트폴리오를 재편해야 할 때입니다. `;
  }

  // 3. 목표 생활비 수준에 따른 조언 (4가지)
  if (targetInManwon < 200) {
    strategy = `목표하신 월 ${targetInManwon}만 원은 알뜰한 생활이 요구되는 수준입니다. 국민연금과 기초연금 등 기본 안전망을 최대한 활용한다면 계획 달성이 비교적 수월할 수 있습니다. `;
  } else if (targetInManwon >= 200 && targetInManwon < 350) {
    strategy = `목표하신 월 ${targetInManwon}만 원은 표준적인 은퇴 생활비 수준입니다. 식비, 주거비 외에 여가 비용까지 포함된 금액이므로 국민연금 외에도 IRP나 연금저축을 통한 추가 현금흐름이 반드시 뒷받침되어야 해요. `;
  } else if (targetInManwon >= 350 && targetInManwon < 500) {
    strategy = `목표하신 월 ${targetInManwon}만 원은 여유로운 노후를 즐기기에 충분한 금액입니다. 다만 생활비 규모가 큰 만큼 인플레이션 방어를 위해 배당주나 ETF 같은 수익성 자산을 일정 비율 꼭 유지해 주시는 것이 좋습니다. `;
  } else {
    strategy = `월 ${targetInManwon}만 원 이상의 풍족한 생활을 계획하고 계시네요. 고액의 생활비를 지속하려면 단순히 저축만으로는 한계가 있으므로, 부동산 임대 수익이나 고배당 포트폴리오 등 강력한 패시브 인컴 시스템 구축이 필수적입니다. `;
  }

  // 4. 은퇴까지 남은 기간에 따른 액션 플랜 (3가지)
  if (yearsToRetire < 5) {
    strategy += `은퇴까지 ${yearsToRetire}년밖에 남지 않았기 때문에 지금은 무리하게 투자금을 늘리기보다, 가지고 있는 자산의 현금화 시기와 세금(연금소득세 등)을 꼼꼼히 계산해 보셔야 해요. `;
    if (score < 70) strategy += `목표 금액에 비해 자산이 다소 부족해 보이니, 은퇴 시기를 2~3년 정도 늦추거나 은퇴 후 소일거리를 통해 보조 소득을 만드는 것도 좋은 대안이 됩니다.`;
    else strategy += `현재의 좋은 흐름을 유지하시면서 안정적인 자산 배분에 집중해 보세요.`;
  } else if (yearsToRetire >= 5 && yearsToRetire < 15) {
    strategy += `앞으로 은퇴까지 남은 ${yearsToRetire}년은 노후 준비의 골든타임입니다. `;
    if (score < 70) strategy += `매월 납입하는 연금 저축액이나 투자 금액을 지금보다 대폭 늘리시는 것을 적극 권장드려요. 이 시기의 집중 투자가 훗날 큰 차이를 만듭니다.`;
    else strategy += `현재 설정해 두신 납입 플랜이 아주 잘 작동하고 있으니, 시장 변동성에 흔들리지 말고 꾸준히 유지해 주세요.`;
  } else {
    strategy += `은퇴까지 ${yearsToRetire}년이라는 긴 시간이 남아 있어 정말 든든합니다. `;
    if (score < 70) strategy += `아직 시간이 많으니 지금부터라도 매월 조금씩 우량주나 ETF 모으기를 시작해 보세요. 적은 금액이라도 일찍 시작하는 것이 승리하는 길입니다.`;
    else strategy += `시간이라는 가장 강력한 무기를 가지고 계시니, 현재의 장기 투자 스탠스를 잘 유지하시면 복리가 마법을 부려줄 거예요.`;
  }

  let finalAdvice = analysis + strategy;

  // Basic 요금제 일 경우 요약
  if (!isPro) {
    // 8줄 미만으로 제한하라는 프롬프트 요구사항 반영을 위해 길이를 축약
    const sentences = finalAdvice.split('. ');
    if (sentences.length > 3) {
      finalAdvice = sentences.slice(0, 3).join('. ') + '.';
    }
  }

  return finalAdvice + outro;
}
