import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WsLib } from './ws-lib';

describe('WsLib', () => {
  let component: WsLib;
  let fixture: ComponentFixture<WsLib>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WsLib]
    })
      .compileComponents();

    fixture = TestBed.createComponent(WsLib);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
