import type { ReactNode } from "react";
import type { Customization, ProfileSpace } from "../schema";
import { blockLabels, worldLabels } from "../worlds";

export function ProfileAvatar({ avatar, seed = "", small = false }: { avatar: Customization["avatar"]; seed?: string; small?: boolean }) {
  const turn = [...seed].reduce((value, char) => (value + char.charCodeAt(0)) % 4, 0) * 90;
  return <svg className={`profile-avatar${small ? " profile-avatar-small" : ""}`} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="98" height="98" rx="28" className="profile-avatar-ground" />
    <g className="profile-avatar-mark" transform={`rotate(${turn} 50 50)`}>
      {avatar === "orbit" && <><circle cx="50" cy="50" r="19" fill="currentColor" /><ellipse cx="50" cy="50" rx="38" ry="17" transform="rotate(-35 50 50)" fill="none" stroke="currentColor" strokeWidth="4" /><circle cx="79" cy="29" r="6" fill="currentColor" /></>}
      {avatar === "arch" && <><path d="M25 75V47a25 25 0 0 1 50 0v28H61V47a11 11 0 0 0-22 0v28Z" fill="currentColor" /><circle cx="50" cy="68" r="6" fill="currentColor" /></>}
      {avatar === "spark" && <><path d="m50 14 9 25 25 11-25 9-9 27-11-27-25-9 25-11Z" fill="currentColor" /><circle cx="78" cy="22" r="5" fill="currentColor" /></>}
      {avatar === "grid" && <>{[[24,24],[53,24],[24,53],[53,53]].map(([x,y], index) => <rect key={index} x={x} y={y} width="23" height="23" rx={index === 1 ? "11.5" : "4"} fill="currentColor" />)}</>}
    </g>
  </svg>;
}

const modeLabels = { online: "Онлайн", in_person: "Лично", either: "Онлайн или лично" };
const formatLabels = { one_to_one: "Вдвоём", group: "В компании", either: "Любая компания" };
function postCount(count: number) {
  const label = count % 10 === 1 && count % 100 !== 11 ? "заявка" : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? "заявки" : "заявок";
  return `${count} ${label}`;
}

export function ProfileScene({ space, children, compact = false }: { space: ProfileSpace; children?: ReactNode; compact?: boolean }) {
  return <section className={`profile-scene${compact ? " profile-scene-compact" : ""}`} data-world={space.presentation.world} data-accent={space.presentation.accent} aria-label={`Пространство ${space.identity.alias}`}>
    <div className="profile-cover" aria-hidden="true">
      <div className="profile-cover-orbit" /><div className="profile-cover-disc" /><div className="profile-cover-line" /><div className="profile-cover-spark">✳</div>
      <span className="profile-cover-caption">{worldLabels[space.presentation.world]} / INTAVRO</span>
    </div>
    <div className="profile-scene-body">
      <header className="profile-identity">
        <ProfileAvatar avatar={space.presentation.avatar} seed={space.identity.avatarSeed} />
        <div className="profile-identity-copy">
          <p className="profile-world-label">{worldLabels[space.presentation.world]} <span aria-hidden="true">↗</span></p>
          <h2 className="profile-alias">{space.identity.alias}</h2>
          {space.status && <p className="profile-status"><span aria-hidden="true" />{space.status}</p>}
        </div>
      </header>
      {space.tagline && <p className="profile-tagline">{space.tagline}</p>}
      {children && !compact && <div className="profile-scene-action">{children}</div>}
      <div className="profile-blocks">
        {space.blockOrder.map((block, index) => {
          let content: ReactNode = null;
          if (block === "intent" && space.currentIntent) content = <>
            <p className="profile-intent-label">{space.currentIntent.activityLabel}</p>
            <div className="profile-intent-meta"><span>{modeLabels[space.currentIntent.interactionMode]}</span><span>{formatLabels[space.currentIntent.format]}</span>{space.currentIntent.timeHint && <span>{({'Compatible today':'Подходит сегодня','Compatible tomorrow':'Подходит завтра','Compatible this week':'Подходит на этой неделе','Compatible soon':'Подходит в ближайшее время'} as Record<string,string>)[space.currentIntent.timeHint]??space.currentIntent.timeHint}</span>}</div>
          </>;
          if (block === "activities" && space.activities.length) content = <ul className="profile-activities">{space.activities.map(activity => <li key={activity.activityKey}><span>{activity.activityLabel}</span><span className="profile-count">{postCount(activity.count)}</span></li>)}</ul>;
          if (block === "interests" && space.interests.length) content = <ul className="profile-interests">{space.interests.map(interest => <li key={interest}>{interest}</li>)}</ul>;
          if (block === "goals" && space.goals.length) content = <ul className="profile-goals">{space.goals.map(goal => <li key={goal}><span aria-hidden="true">↗</span>{goal}</li>)}</ul>;
          if (!content) return null;
          return <section className={`profile-block profile-block-${block}`} key={block}><div className="profile-block-heading"><h3>{blockLabels[block]}</h3><span aria-hidden="true">0{index + 1}</span></div>{content}</section>;
        })}
      </div>
      {children && compact && <div className="profile-scene-action">{children}</div>}
      {!space.currentIntent && !space.activities.length && !space.interests.length && !space.goals.length && !compact && <p className="profile-empty">Здесь начинается что-то новое.</p>}
      {!compact && <footer className="profile-scene-footer"><span>Маленький мир. Большие возможности.</span><span aria-hidden="true">✳</span></footer>}
    </div>
  </section>;
}
